# Deploy checklist — Base mainnet

Base mainnet (id `8453`) is the **canonical chain** for PanoramaBlock — the first chain to host
production contracts. Aerodrome is the inaugural protocol adapter.

This document is the operator checklist for deploying / re-deploying. For a generic chain-onboarding
walkthrough see [`../_template/README.md`](../_template/README.md).

> Manifest counterpart: `backend/shared/capability/chains/base.manifest.json` (chain id 8453,
> capabilities `[swap, lending, liquidity]`).

---

## Pre-requisites

- [ ] `BASE_RPC_URL` set in `.env` (recommend Alchemy/QuickNode with archive support)
- [ ] `PRIVATE_KEY` set in `.env` (deployer EOA, hex without `0x`)
- [ ] `BASESCAN_API_KEY` set in `.env` (free at https://basescan.org/myapikey)
- [ ] Deployer wallet funded with **≥ 0.003 ETH** on Base mainnet
  - Estimated total gas: ~3.1M (Adapter 1.07M + Beacon 305K + Executor 1.59M + register 150K)
  - At 0.02 gwei (typical Base): ~0.000062 ETH (~$0.22)
  - At 0.1 gwei (spike): ~0.00031 ETH (~$1.10)
  - 0.003 ETH gives 10x margin + headroom for future adapters

---

## Step 1 — Smoke fork (no broadcast, no funds needed)

```bash
forge script script/DeployV2.s.sol \
  --rpc-url $BASE_RPC_URL \
  --sender $(cast wallet address --private-key $PRIVATE_KEY)
```

Reviews:

- [ ] All 4 deploy steps printed without revert
- [ ] Predicted gas total < 5M (we expect ~3.1M; if higher, investigate before broadcasting)
- [ ] Predicted addresses written to `deployments/base/*.json` (with `txHash: "0x_TBD_AFTER_BROADCAST"`)
- [ ] `git diff` shows expected file changes — review before committing

If anything looks off, fix and re-run the fork. The fork run is free and safe.

---

## Step 2 — Real broadcast

```bash
source .env
forge script script/DeployV2.s.sol \
  --rpc-url $BASE_RPC_URL \
  --broadcast --verify \
  --etherscan-api-key $BASESCAN_API_KEY
```

What happens on-chain:

1. `AerodromeAdapterV2` deployed
2. `UpgradeableBeacon` deployed pointing to (1)
3. `PanoramaExecutorV2` deployed
4. `executor.registerBeacon(keccak256("aerodrome"), beacon, abi.encode(router, voter))` called

The script writes / overwrites:

- `deployments/base/PanoramaExecutorV2.json`
- `deployments/base/AerodromeAdapterV2.json`
- `deployments/base/AerodromeBeacon.json`

If `--verify` succeeds inline, the contracts appear verified on BaseScan within ~30 s. If it
fails, you can re-run verification manually (Step 4).

---

## Step 3 — Update the JSONs with on-chain provenance

The script can't know the block number / inclusion txHash mid-broadcast. After the run, copy
those from Foundry's broadcast log (`broadcast/DeployV2.s.sol/8453/run-latest.json`) into each
JSON file:

```bash
# Foundry leaves the broadcast log at:
cat broadcast/DeployV2.s.sol/8453/run-latest.json | jq '.transactions[].transactionType, .transactions[].hash, .transactions[].contractAddress'

# For each artifact, set:
#   "blockNumber": <block from receipt>,
#   "txHash":       <hash from broadcast log>,
#   "deployedAt":   <ISO timestamp>,
#   "verified":     true,
#   "verifiedUrl":  "https://basescan.org/address/<addr>#code"
```

A helper script lives at [`scripts/seal-deployment.sh`](../../scripts/seal-deployment.sh) — runs
the above edits automatically after pointing it at the broadcast directory.

---

## Step 4 — Verify on BaseScan (only if `--verify` failed during broadcast)

For each of the 3 contracts:

```bash
# PanoramaExecutorV2 (no constructor args)
forge verify-contract \
  --watch --chain 8453 \
  --etherscan-api-key $BASESCAN_API_KEY \
  $(jq -r .address deployments/base/PanoramaExecutorV2.json) \
  contracts/aerodrome/core/PanoramaExecutorV2.sol:PanoramaExecutorV2

# AerodromeAdapterV2 (no constructor args)
forge verify-contract \
  --watch --chain 8453 \
  --etherscan-api-key $BASESCAN_API_KEY \
  $(jq -r .address deployments/base/AerodromeAdapterV2.json) \
  contracts/aerodrome/adapters/AerodromeAdapterV2.sol:AerodromeAdapterV2

# UpgradeableBeacon (constructor: implementation address + owner address)
ADAPTER=$(jq -r .address deployments/base/AerodromeAdapterV2.json)
DEPLOYER=$(jq -r .deployer deployments/base/AerodromeBeacon.json)
forge verify-contract \
  --watch --chain 8453 \
  --etherscan-api-key $BASESCAN_API_KEY \
  --constructor-args $(cast abi-encode "constructor(address,address)" $ADAPTER $DEPLOYER) \
  $(jq -r .address deployments/base/AerodromeBeacon.json) \
  @openzeppelin/contracts/proxy/beacon/UpgradeableBeacon.sol:UpgradeableBeacon
```

Update `verified: true` and `verifiedUrl` in each JSON after success.

---

## Step 5 — Smoke live (read-only sanity)

```bash
EXECUTOR=$(jq -r .address deployments/base/PanoramaExecutorV2.json)

# Owner is the deployer EOA
cast call $EXECUTOR "owner()(address)" --rpc-url $BASE_RPC_URL
# expected: <your deployer address>

# Aerodrome beacon registered
cast call $EXECUTOR "getBeacon(bytes32)(address)" \
  $(cast keccak "aerodrome") \
  --rpc-url $BASE_RPC_URL
# expected: <deployments/base/AerodromeBeacon.json .address>
```

---

## Step 6 — Commit

```bash
git add deployments/base/*.json deployments/base/README.md broadcast/DeployV2.s.sol/8453/
git commit -m "chore(deploy): record Base mainnet addresses (PanoramaExecutorV2 + Aerodrome)"
```

The `broadcast/` log is committed as the canonical record of the deployment — useful for audits.

---

## Step 7 — Wire backend services

Backend providers that need the executor address:

- `backend/liquid-swap-service` → Rizzi's #230 will read `deployments/base/PanoramaExecutorV2.json`
- `backend/liquidity-service` (new) → Rizzi's #253
- Future Moonwell lending adapter (Marcos) → reads same JSON for executor address

Each backend PR that depends on the deploy adds the JSON import to its DI container.

---

## Step 8 — Announce in `#panorama-dev`

```
🚦 Base mainnet — PanoramaExecutorV2 LIVE

  ExecutorV2:        <addr>  https://basescan.org/address/<addr>#code
  AerodromeAdapterV2:<addr>  https://basescan.org/address/<addr>#code
  AerodromeBeacon:   <addr>  https://basescan.org/address/<addr>#code

  Tx (registerBeacon): https://basescan.org/tx/<tx>
  Block:               <n>

  Rizzi: liquid-swap-service pode apontar pro novo ExecutorV2.
  Marcos / Coletto: quando seu adapter on-chain estiver pronto, registra via script/RegisterAdapter.s.sol.
```

---

## Rollback

If the deploy was botched **and no user has used it yet**:

- Re-run `script/DeployV2.s.sol` (deploys fresh contracts at new nonce)
- Overwrite the JSONs (script does this automatically)
- Old contracts stay on-chain but unreferenced — no operational impact

If users have interacted (transactions through the old executor):

- **Do not** redeploy. Use `beacon.upgradeTo(newImpl)` for adapter bugs (preserves user state).
- For executor bugs: this is an incident. Engage `#panorama-incidents` before any action.

---

## See also

- `../README.md` — multi-chain deployments overview
- `../_template/README.md` — generic per-chain checklist
- `../../docs/adapter-registration.md` — adding a new protocol adapter
- `../../script/DeployV2.s.sol` — the script itself
