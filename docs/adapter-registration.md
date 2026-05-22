# Adding a new on-chain adapter

Generic workflow for registering a new protocol adapter (Moonwell lending, Aave, sFRAX,
Aerodrome LP on a new chain, …) end-to-end. Mirrors the capability + provider abstraction
from ADR 002 on the on-chain side.

Read first:
- [ADR 002 — capability + provider abstraction](adr/002-capability-provider-abstraction.md)
- [ADR 005 — chain onboarding model](adr/005-chain-onboarding-model.md)
- [`deployments/_template/README.md`](../deployments/_template/README.md) — per-chain deploy checklist
- [`SPRINT_HUGO.md`](../../SPRINT_HUGO.md) Bloco 6 — example walk-through with Aerodrome

---

## When does a new adapter ship?

Any of these triggers an adapter PR:

- **New protocol on a chain we already support** (e.g. Moonwell on Base)
- **Existing protocol on a chain we just onboarded** (e.g. Aerodrome on a future L2 fork)
- **New version of an existing protocol** (e.g. AerodromeAdapterV3) — note: prefer upgrading
  via `beacon.upgradeTo(newImpl)` over deploying a fresh adapter when storage layout permits.

If neither applies, you're probably looking for a **backend adapter** (a TypeScript class that
calls an SDK), not an on-chain adapter. The two are different layers — backend adapters live in
`backend/<service>/src/infrastructure/adapters/`, on-chain adapters live in
`contracts/<chain>/adapters/`.

---

## End-to-end workflow

### 1. Decide the `protocolId`

`protocolId` is a `bytes32` derived from `keccak256(name)`. Lowercase ASCII, no spaces.

| Name | `protocolId` (Solidity) |
|---|---|
| `aerodrome` | `keccak256("aerodrome")` |
| `moonwell` | `keccak256("moonwell")` |
| `trader-joe` | `keccak256("trader-joe")` |

Pin this in the deploy script:

```solidity
bytes32 constant MOONWELL_ID = keccak256("moonwell");
```

The corresponding backend provider name (in `ProviderMetadata.name`) is the same string,
keeping vocabulary aligned between layers (CONVENTIONS.md §5).

### 2. Implement the adapter contract

Inherit from `IProtocolAdapter` (or the equivalent base). The adapter must:

- Be **stateless** outside of its `Initializable + __gap[50]` storage — the BeaconProxy stores
  per-user state, the implementation can be upgraded.
- Use `SafeTransferLib` for ERC-20 ops (no raw `IERC20.transfer`).
- Expose actions matching the capability's port interface (swap → `swap(...)`,
  lending → `supply(...)` / `borrow(...)`).
- Emit a domain event per state-mutating action with the user address indexed.

Reference: [`contracts/aerodrome/adapters/AerodromeAdapterV2.sol`](../contracts/aerodrome/adapters/AerodromeAdapterV2.sol)

### 3. Foundry tests — fork mainnet, no Solidity mocks

Project rule (memory: `feedback_no_mocks`): adapter tests **fork real mainnet** of the chain
the adapter targets. Solidity mocks of router/gauge/cToken have caused real ABI bugs in the past.

```bash
# tests live next to the adapter under test/
test/adapters/MoonwellLendAdapter.fork.t.sol
```

Run:

```bash
forge test --match-path "test/adapters/Moonwell*.t.sol" \
  --fork-url $BASE_RPC_URL -vvv
```

CI runs the full fork suite nightly (workflow in `.github/workflows/`).

### 4. Deploy script

Add `script/Deploy<Protocol>.s.sol`:

```solidity
contract DeployMoonwell is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);

        vm.startBroadcast(deployerPrivateKey);

        MoonwellLendAdapter impl = new MoonwellLendAdapter();
        UpgradeableBeacon beacon = new UpgradeableBeacon(address(impl), deployer);

        // Register on the existing executor (read its address from deployments/)
        address executor = vm.parseJsonAddress(
            vm.readFile("deployments/base/PanoramaExecutorV2.json"),
            ".address"
        );
        bytes memory initArgs = abi.encode(MOONWELL_COMPTROLLER);
        PanoramaExecutorV2(executor).registerBeacon(keccak256("moonwell"), address(beacon), initArgs);

        vm.stopBroadcast();

        // Persist artifacts — see deployments/_template/ for shape.
        _writeArtifact("MoonwellLendAdapter", address(impl));
        _writeArtifact("MoonwellBeacon", address(beacon));
    }
}
```

Adapt from [`script/DeployV2.s.sol`](../script/DeployV2.s.sol) for the patterns.

### 5. Run the per-chain checklist

Follow [`deployments/_template/README.md`](../deployments/_template/README.md) — fork smoke,
broadcast, verify, commit JSONs, smoke live.

### 6. Wire the backend provider

The backend service that owns this capability (`lending-service` for Moonwell, etc.) needs to
register a TypeScript adapter that calls the freshly-deployed contract:

```typescript
// backend/lending-service/src/infrastructure/adapters/moonwell.provider.adapter.ts
import { getChain } from "@panorama/capability/chains";
import deployment from "<execution-layer>/deployments/base/MoonwellLendAdapter.json";

export class MoonwellLendingAdapter implements ILendingProvider {
  readonly name = "moonwell";
  readonly metadata = {
    name: "moonwell",
    capability: "lending" as const,
    supportedChains: [getChain("base").id],
    version: "1.0.0",
    enabled: true,
  };
  // calls deployment.address via ethers
}
```

The backend reads `deployments/<chain>/<Contract>.json` (committed alongside the on-chain deploy
PR) to learn the address — no env var required, no hardcoding.

### 7. PR pairing

An adapter ships as **two PRs**:

| Layer | Branch | Touches |
|---|---|---|
| On-chain | `feat/<dev>-contracts-<protocol>` | `contracts/`, `script/`, `test/`, `deployments/` |
| Backend | `feat/<dev>-<capability>-<protocol>` | `backend/<capability>-service/src/infrastructure/adapters/` |

The backend PR depends on the on-chain PR (needs the deployment JSON). Open both, mark backend
as stacked, mergeia on-chain first.

---

## Anti-patterns (will block review)

- ❌ Hardcoded protocol address in the backend (`const MOONWELL = "0x..."`). Always read from `deployments/`.
- ❌ Adapter contract that holds funds in its own storage (must be on the proxy).
- ❌ Adapter test that mocks the router/gauge/cToken instead of forking. See memory rule.
- ❌ New `protocolId` overlapping an existing one (`keccak256` collision after lowercase normalisation). Check the registry before picking the name.
- ❌ Deploying without `--verify` flag and forgetting `forge verify-contract` later. Unverified contracts on mainnet are operational debt.

---

## Cheat sheet

```bash
# Build + fork test
forge build
forge test --match-path "test/adapters/Moonwell*.t.sol" --fork-url $BASE_RPC_URL -vvv

# Smoke fork (dry-run, no broadcast)
forge script script/DeployMoonwell.s.sol \
  --rpc-url $BASE_RPC_URL \
  --sender $(cast wallet address --private-key $PRIVATE_KEY)

# Real deploy + verify
forge script script/DeployMoonwell.s.sol \
  --rpc-url $BASE_RPC_URL \
  --broadcast --verify \
  --etherscan-api-key $BASESCAN_API_KEY

# Confirm registry on-chain
cast call $(jq -r .address deployments/base/PanoramaExecutorV2.json) \
  "getBeacon(bytes32)(address)" \
  $(cast keccak "moonwell") \
  --rpc-url $BASE_RPC_URL
```

---

## See also

- [ADR 002](adr/002-capability-provider-abstraction.md) — port/adapter pattern (backend side)
- [ADR 005](adr/005-chain-onboarding-model.md) — chain manifests
- [`deployments/README.md`](../deployments/README.md) — artifact schema
- [`SPRINT_HUGO.md`](../../SPRINT_HUGO.md) Bloco 6 — Aerodrome walk-through
