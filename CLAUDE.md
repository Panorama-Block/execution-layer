# CLAUDE.md — Panorama Execution Layer

Guidelines for working with this codebase.

## Language

Always respond in **Brazilian Portuguese (pt-BR)**.

## Required reading

Always read `README.md` at the project root before starting any task.

## Architecture Decision Records (ADRs)

Long-lived architectural commitments live in `docs/adr/`. Read these before designing any backend or cross-cutting change:

- [ADR 001 — Backend-first architecture](docs/adr/001-backend-first-architecture.md) — protocol names live only in backend adapters; FE/agents/bot/gateway speak capability vocabulary
- [ADR 002 — Capability + Provider abstraction](docs/adr/002-capability-provider-abstraction.md) — the five-layer pattern (port → adapter → facade → controller → DI) and canonical vocabulary
- [ADR 003 — Lane and feature taxonomy](docs/adr/003-lane-feature-taxonomy.md) — the 18 closed Lanes and per-sprint Features used on the PanoramaBlock Planning board
- [ADR 004 — Layer dependency rules](docs/adr/004-layer-dependency-rules.md) — `shared/capability/` is a sink; no cross-service imports; FE/agents talk HTTP
- [ADR 005 — Chain onboarding model](docs/adr/005-chain-onboarding-model.md) — chains as manifest files; no chainId literals outside `shared/capability/chains/`

New ADRs go in `docs/adr/00N-<slug>.md` following the same shape (Context / Decision / Consequences / References). Open them via PR with the relevant board card linked.

## Repository layout

```
execution-layer/
├── contracts/
│   ├── aerodrome/       # Base: PanoramaExecutorV2, AerodromeAdapterV2, DCAVault
│   └── avax/            # Avalanche: TraderJoeAdapter, BenqiLendAdapter, SAVAXAdapter
├── backend/             # Node.js/TypeScript — Express API
├── script/              # Foundry deploy scripts (V1 + V2)
├── test/                # Foundry tests (unit + fork)
└── frontend/            # Demo UI
```

## Test commands

```bash
# Solidity unit tests (no RPC needed)
forge test -vv --no-match-path "test/fork/*"

# Fork tests (requires BASE_RPC_URL)
BASE_RPC_URL=https://mainnet.base.org forge test --match-path "test/fork/*" -vvv

# Backend (Vitest)
cd backend && npm test
```

**Always run both suites after any change.** Do not commit with failing tests.

## Core architecture

### V2: BeaconProxy (upgradeable)

The system uses **BeaconProxy** (OpenZeppelin) instead of EIP-1167:
- Each protocol has an `UpgradeableBeacon` that stores the implementation address
- Each user gets a `BeaconProxy` that delegates to the beacon
- `beacon.upgradeTo(newImpl)` upgrades ALL users at once
- Adapters use `Initializable` + `__gap[50]` for storage stability

### PanoramaExecutorV2 — single entry point (both chains)

```solidity
function execute(
    bytes32 protocolId,
    bytes4  action,              // bytes4(keccak256("functionName(types...)"))
    Transfer[] calldata transfers,
    uint256 deadline,
    bytes calldata data
) external payable returns (bytes memory result)
```

The executor **does not know any specific action**. It only:
1. Creates/retrieves the user's BeaconProxy for `protocolId`
2. Pulls tokens from the user to the proxy via `transfers`
3. Calls `proxy.call(action ++ data)` — blind dispatch

**Never add action-specific logic to the executor.** All logic goes in the adapter.

### Protocol registration

```solidity
// on-chain
executor.registerBeacon(keccak256("aerodrome"), beaconAddress, abi.encode(router, voter));
```

```typescript
// backend
registerProtocol("aerodrome", { protocolId: "aerodrome", chain: "base", ... });
```

Zero changes needed in the executor or BundleBuilder.

### Adapter initialization

All V2 adapters use the same signature:

```solidity
function initializeFull(address _executor, bytes calldata _initArgs) external initializer
```

The executor stores `protocolInitArgs` per protocol and passes them to `initializeFull` when creating the proxy.

## ADAPTER_SELECTORS — full Solidity selectors

The selectors in `backend/src/shared/bundle-builder.ts` use the **full signature**:

```typescript
ethers.id("swap(address,address,uint256,uint256,address,bool)").slice(0, 10)
```

Do not use `ethers.id("swap")` — that is keccak256 of the name without types.

## BundleBuilder — single bundle assembly point

```typescript
new BundleBuilder(chainId)
  .addApproveIfNeeded(token, spender, currentAllowance, required, "Approve X")
  .addExecute(protocolId, ADAPTER_SELECTORS.SWAP, transfers, deadline, adapterData, 0n, executor, "Swap")
  .build("summary")
```

**Never construct `PreparedTransaction` manually outside of BundleBuilder.**

## adapterData encoding

The `data` passed to `execute()` must be **exactly** the `abi.encode` of the adapter function's typed parameters, **without the selector**:

```typescript
const adapterData = ethers.AbiCoder.defaultAbiCoder().encode(
  ["address", "address", "uint256", "uint256", "address", "bool"],
  [tokenIn, tokenOut, amountIn, amountOutMin, recipient, stable]
);
```

## Service modules

Each product has its own module in `backend/src/modules/<name>/`:
- `usecases/` — business logic, builds bundles
- `controllers/` — HTTP request/response parsing
- `routes/` — registers Express routes

### Base
- `modules/swap/` — Aerodrome swap
- `modules/liquid-staking/` — Aerodrome gauges
- `modules/dca/` — DCAVault automation

### Avalanche
- `modules/avax-swap/` — Trader Joe V1
- `modules/avax-lending/` — Benqi Finance

## Contracts — rules

- `PanoramaExecutorV2.sol`: never add action-specific functions. The generic `execute()` is the only entry point.
- V2 Adapters: always use `Initializable`, `onlyExecutor`, `__gap[50]`, `receive() external payable`.
- `DCAVault.sol`: uses the `IPanoramaExecutor` interface (same signature V1/V2).
- Storage layout: never reorder storage variables in upgrades. Only append at the end and reduce `__gap`.

## Supported chains

| Chain | Status | Protocols |
|-------|--------|-----------|
| Base (8453) | Active | Aerodrome Finance |
| Avalanche (43114) | Active | Trader Joe, Benqi, sAVAX |

The backend uses `getChainConfig("base")` or `getChainConfig("avalanche")` from `config/chains.ts`.

## Mocking in Vitest tests

`vi.mock()` is hoisted by Vitest. Variables referenced inside the factory must be declared with `vi.hoisted()`:

```typescript
const { mockFn } = vi.hoisted(() => ({ mockFn: vi.fn() }));
vi.mock("../../some/module", () => ({ myFunc: mockFn }));
```
