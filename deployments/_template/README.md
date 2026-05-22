# Deploy checklist — `<chain-slug>`

> Copy this directory to `deployments/<chain-slug>/` when onboarding a new chain. Replace every
> `<placeholder>` with the chain-specific value.

## Pre-requisites

- [ ] Chain manifest exists at `backend/shared/capability/chains/<chain-slug>.manifest.json`
- [ ] ADR amendment (if this is the first chain of a new ecosystem) — see ADR 005
- [ ] `.env` populated with:
  - `<CHAIN>_RPC_URL` — RPC endpoint with archive support if possible
  - `PRIVATE_KEY` — deployer EOA private key (hex, no `0x` for `vm.envUint`)
  - `<CHAIN_EXPLORER>_API_KEY` — for `--verify` (e.g. `BASESCAN_API_KEY`, `SNOWTRACE_API_KEY`)
- [ ] Deployer wallet funded with enough native asset for gas
  - Base mainnet typical: 0.003 ETH covers ExecutorV2 + Adapter + Beacon + register
  - Avalanche typical: 0.05 AVAX covers same shape
- [ ] Foundry installed and `forge build` succeeds locally

## Step-by-step

### 1. Smoke fork (no broadcast — sanity)

Simulate the deploy against a fork to confirm constructor args, gas usage, and storage layout:

```bash
forge script script/DeployV2.s.sol \
  --rpc-url $<CHAIN>_RPC_URL \
  --sender $(cast wallet address --private-key $PRIVATE_KEY)
```

This **does not** broadcast. Check the console output for predicted addresses and gas totals.

### 2. Broadcast deploy

```bash
forge script script/DeployV2.s.sol \
  --rpc-url $<CHAIN>_RPC_URL \
  --broadcast \
  --verify \
  --etherscan-api-key $<CHAIN_EXPLORER>_API_KEY
```

The script writes `<Contract>.json` artifacts into `deployments/<chain-slug>/` automatically.

### 3. Register the adapter (only if separate from DeployV2)

`DeployV2.s.sol` already calls `executor.registerBeacon(...)` in the same broadcast. If you
added a new adapter without redeploying the executor, use:

```bash
forge script script/RegisterAdapter.s.sol \
  --sig "run(string)" "<protocol-id>" \
  --rpc-url $<CHAIN>_RPC_URL \
  --broadcast
```

Confirm on-chain registry:

```bash
cast call <executor-address> "getBeacon(bytes32)(address)" \
  $(cast keccak "<protocol-id>") \
  --rpc-url $<CHAIN>_RPC_URL
```

### 4. Verify on explorer (if `--verify` failed during deploy)

```bash
forge verify-contract \
  --watch \
  --etherscan-api-key $<CHAIN_EXPLORER>_API_KEY \
  --chain <chain-id> \
  <contract-address> \
  <ContractName>
```

For adapters with constructor args, also pass:

```bash
  --constructor-args $(cast abi-encode "constructor(address,address)" <arg1> <arg2>)
```

### 5. Commit the artifacts

```bash
git add deployments/<chain-slug>/*.json deployments/<chain-slug>/README.md
git commit -m "chore(deploy): record <chain-slug> mainnet addresses"
```

### 6. Update backend addresses

For each capability service that points to on-chain contracts (`liquid-swap-service`,
`bridge-service`, future `liquidity-service`):

- Read the new address from `deployments/<chain-slug>/<Contract>.json`
- Inject via env var or service config (no hardcoding)

### 7. Smoke test live

```bash
# Read-only: confirm contract is alive and owner set correctly.
cast call <executor-address> "owner()(address)" --rpc-url $<CHAIN>_RPC_URL

# Adapter registered?
cast call <executor-address> "getBeacon(bytes32)(address)" $(cast keccak "aerodrome") \
  --rpc-url $<CHAIN>_RPC_URL
```

### 8. Announce in `#panorama-dev`

```
🚦 <chain-slug> mainnet deployed:
   PanoramaExecutorV2: <addr>
   AerodromeAdapterV2: <addr>
   Beacon:             <addr>
   Tx:                 <tx-url>
   Verified:           <explorer-url>
```

## Rollback / re-deploy

If a deploy goes wrong **before** users have signed transactions through it:
- Just deploy a fresh executor and update backend pointers. The old executor stays on-chain
  but unreferenced.
- Update `deployments/<chain-slug>/<Contract>.json` to reflect the new address; commit.

If users have already used the executor:
- **Do not** redeploy. Use `beacon.upgradeTo(newImpl)` to fix the adapter (storage layout
  must remain compatible — see `__gap[50]` in adapter source).
- For executor-level bugs that aren't fixable via beacon upgrade: coordinate carefully, this
  is a real incident, not a routine.

## See also

- `../README.md` — deployments overview + JSON schema
- `../../docs/adr/005-chain-onboarding-model.md` — why chains are first-class entities
- `../../docs/adapter-registration.md` — generic flow for new protocol adapters
