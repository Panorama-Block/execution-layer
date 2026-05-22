# Deployments

Per-chain registry of deployed PanoramaBlock contracts. Each subdirectory is named after a
chain slug (see ADR 005 — chain onboarding model) and contains one JSON file per deployed
contract plus a `README.md` with the deploy checklist for that chain.

## Layout

```
deployments/
├── README.md                       # this file
├── _template/                      # copy this when onboarding a new chain
│   ├── README.md                   # per-chain deploy checklist template
│   ├── PanoramaExecutorV2.json     # contract artifact template
│   └── AerodromeAdapterV2.json     # adapter artifact template
└── <chain-slug>/                   # e.g. base/, avalanche/, ethereum/
    ├── README.md                   # chain-specific deploy notes + verified URLs
    ├── PanoramaExecutorV2.json
    ├── <Protocol>AdapterV2.json    # one file per deployed adapter
    └── <Protocol>Beacon.json       # beacon paired with each adapter
```

Chain slugs **must** match the manifests in
`../../backend/shared/capability/chains/<slug>.manifest.json`.

## Artifact JSON schema

Every deployed contract gets one file in `deployments/<chain-slug>/<ContractName>.json`:

```jsonc
{
  "contract": "PanoramaExecutorV2",         // contract class name
  "address": "0x...",                       // 0x-prefixed checksummed address
  "deployer": "0x...",                      // EOA that broadcasted the deploy
  "chainId": 8453,                          // EIP-155 chain id
  "blockNumber": 12345678,                  // mined block
  "txHash": "0x...",                        // deploy transaction
  "deployedAt": "2026-05-22T15:30:00.000Z", // ISO-8601 UTC
  "verified": true,                         // BaseScan/Etherscan verification status
  "verifiedUrl": "https://basescan.org/address/0x...#code",
  "constructorArgs": [],                    // empty for executors; populated for adapters
  "compiler": "0.8.24",
  "optimizer": { "enabled": true, "runs": 200 },
  "source": "contracts/aerodrome/core/PanoramaExecutorV2.sol",
  "deployScript": "script/DeployV2.s.sol",
  "notes": "First mainnet deploy. Adapter registered in same script."
}
```

Fields are **required** unless documented as optional in `_template/`.

## When you deploy

The deploy script (`script/DeployV2.s.sol`) writes these JSONs automatically via `vm.writeJson`
when run with `--broadcast`. You then commit the produced JSON files alongside the deploy PR.

For the per-chain operator checklist see `_template/README.md` (and the chain-specific copy at
`<chain-slug>/README.md`).

## Adding a new chain

Follow `../docs/templates/onboard-chain.md` (Coletto's card #79). Short version:

1. Copy `_template/` → `<new-slug>/`
2. Add manifest to `backend/shared/capability/chains/<new-slug>.manifest.json`
3. Deploy with `forge script ... --rpc-url $<NEW>_RPC_URL --broadcast --verify`
4. Commit the resulting JSONs.

## See also

- ADR 005 — chain onboarding model (`../docs/adr/005-chain-onboarding-model.md`)
- ADR 002 — capability + provider abstraction (the on-chain side uses the same protocolId vocabulary)
- `script/DeployV2.s.sol` — the canonical deploy script for Base
- `docs/adapter-registration.md` — workflow for adding a new on-chain adapter
