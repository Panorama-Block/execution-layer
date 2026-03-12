# Refactor: Protocol Neutrality & Unified Preparation Flows

## Context

Two architectural issues were identified in the codebase:

> "The executor is adapter-based, which is good, but the interface is still action-specific (swap, add/remove liquidity, stake, unstake, claimRewards). That is fine for the MVP scope, but it means the executor is not fully protocol-neutral in the stronger sense. It is generic only inside the current action model."

> "The backend currently mixes two abstractions: generic execution routes and product-specific modules. Both prepare similar Aerodrome flows today, which will create drift once we add more protocols, unless we choose one clear public shape."

This document describes every change made to resolve both issues.

---

## Issue 1 — Executor Was Action-Specific

### Before

`PanoramaExecutor.sol` exposed one function per action:

```solidity
function executeSwap(bytes32 protocolId, address tokenIn, address tokenOut, ...) external payable
function executeAddLiquidity(bytes32 protocolId, address tokenA, address tokenB, ...) external payable
function executeRemoveLiquidity(...) external
function executeStake(bytes32 protocolId, address lpToken, uint256 amount, ...) external
function executeUnstake(...) external
function executeClaimRewards(...) external
```

The executor had full knowledge of each action's semantics — making it impossible to add new protocols or new actions without modifying the contract.

### After

`PanoramaExecutor.sol` now exposes a **single, generic entry point**:

```solidity
function execute(
    bytes32 protocolId,
    bytes4  action,              // bytes4(keccak256("functionName(type1,type2,...)"))
    Transfer[] calldata transfers,
    uint256 deadline,
    bytes calldata data
) external payable returns (bytes memory result)
```

The executor has **zero knowledge** of action semantics. It only:
1. Creates or retrieves the user's EIP-1167 adapter clone for `protocolId`
2. Pulls ERC-20 tokens from the user into the clone via `transfers`
3. Forwards the call to the adapter: `adapter.call(action ++ data)`

**Adding a new protocol** → deploy adapter + `registerAdapter()`. No contract changes.
**Adding a new action** → implement it on the adapter. No contract changes.

### Contracts Changed

| File | Change |
|---|---|
| `contracts/core/PanoramaExecutor.sol` | Removed 6 action-specific functions; added single `execute()` |
| `contracts/interfaces/IProtocolAdapter.sol` | Changed all adapter functions to flat typed params (removed `bytes extraData`) |
| `contracts/adapters/AerodromeAdapter.sol` | Updated all implementations to match new flat-param signatures |
| `contracts/interfaces/IPanoramaExecutor.sol` | **Created** — interface with `Transfer` struct + `execute()` for `DCAVault` |
| `contracts/core/DCAVault.sol` | Updated to use `IPanoramaExecutor.execute()` with correct selector |
| `test/PanoramaExecutor.t.sol` | Replaced action-specific tests with `execute()` dispatch tests |
| `test/fork/AerodromeAdapter.t.sol` | Updated to use new `execute()` API |
| `test/fork/AerodromeFork.t.sol` | Updated to use new `execute()` API |
| `test/DCAVault.t.sol` | `MockExecutor` rewritten to implement `IPanoramaExecutor` |

### Key Detail: Selector Encoding

The `bytes4 action` passed to `execute()` must be a proper Solidity function selector — `bytes4(keccak256("functionName(type1,type2,...)"))`. The backend's `ADAPTER_SELECTORS` was updated to use full signatures:

```typescript
// Before (wrong — keccak256 of name only, does not match Solidity ABI)
SWAP: ethers.id("swap").slice(0, 10)

// After (correct — matches bytes4(keccak256(...)) in Solidity)
SWAP: ethers.id("swap(address,address,uint256,uint256,address,bool)").slice(0, 10)
```

---

## Issue 2 — Duplicate Aerodrome Preparation Flows

### Before

The backend had **two competing abstractions** preparing the same on-chain operations:

```
/provider/swap/quote    ← swap-provider.usecase.ts (owns its own quote + prepare logic)
/provider/swap/prepare  ← swap-provider.usecase.ts (builds bundle inline)

/swap/quote    ← modules/swap/usecases/get-quote.usecase.ts   (separate quote logic)
/swap/prepare  ← modules/swap/usecases/prepare-swap.usecase.ts (separate bundle logic)
```

Additionally, `prepare-enter-strategy.usecase.ts` contained ~90 lines of inline bundle construction (allowance checks + approve + addLiquidity + approve LP + stake) with no shared helper equivalent to `buildAerodromeSwapBundle()`.

### After

**One source of truth per operation.** Product modules (`/swap`, `/staking`, `/dca`) are canonical. `/provider/swap` is a thin shape-mapping adapter.

#### Changes

**`modules/swap/usecases/get-quote.usecase.ts`** — Added `stable: "auto"` mode:

```typescript
// Before: stable?: boolean (default false)
// After:  stable?: boolean | "auto"
```

When `stable: "auto"`, the usecase tries both volatile and stable pools, silently ignores missing pools, and returns the best output with `stable: boolean` resolved. This is the single place that owns the "best-of-two" logic.

**`shared/aerodrome-add-liquidity.ts`** — **Created** as the liquidity equivalent of `aerodrome-swap.ts`:

```
approve tokenA (if needed)
→ approve tokenB (if needed)
→ addLiquidity via PanoramaExecutor.execute()
→ approve LP token (if needed)
→ stake via PanoramaExecutor.execute()
```

Handles: parallel allowance checks with `withRetry`, native ETH as tokenA or tokenB, slippage applied to stake amount.

**`modules/liquid-staking/usecases/prepare-enter-strategy.usecase.ts`** — The usecase was reduced from 222 to 130 lines. The inline bundle construction (lines 114–204) was replaced by a single call to `buildAerodromeAddLiquidityBundle()`. The usecase retains ownership of: pool config resolution, balance capping, `quoteAddLiquidity`, and `amountAMin/BMin` calculation.

**`usecases/swap-provider.usecase.ts`** — Became a delegator:

| Function | Before | After |
|---|---|---|
| `executeSwapQuote` | Owned "best-of-two" logic inline | Delegates to `executeGetSwapQuote({ stable: "auto" })`, maps response shape |
| `executeSwapPrepare` | Called own quote + `buildAerodromeSwapBundle` directly | Delegates to `executeGetSwapQuote` + `executePrepareSwapBundle`, maps response shape |
| `executeSupportsRoute` | Unchanged | Unchanged — pool existence check is exclusive to this adapter context |

The `resolveTokenAddress` helper (symbol → address, "native" → ETH) remains in the file as it is specific to the Liquid Swap Service's token naming convention.

---

## Dead Code Removed

Nine files from the old generic execution layer were deleted (they were already unmounted from `index.ts`):

| Deleted File |
|---|
| `backend/src/routes/execution.routes.ts` |
| `backend/src/controllers/execution.controller.ts` |
| `backend/src/usecases/prepare-swap.usecase.ts` |
| `backend/src/usecases/prepare-liquidity.usecase.ts` |
| `backend/src/usecases/prepare-stake.usecase.ts` |
| `backend/src/usecases/get-quote.usecase.ts` |
| `backend/src/usecases/get-pools.usecase.ts` |
| `backend/src/usecases/check-allowance.usecase.ts` |
| `backend/src/usecases/prepare-approve.usecase.ts` |

---

## Test Coverage After Refactor

| Suite | Tests | Notes |
|---|---|---|
| `bundle-builder.test.ts` | 25 | Selector format + uniqueness |
| `aerodrome.service.test.ts` | 29 | Unchanged |
| `aerodrome-add-liquidity.test.ts` | 11 | **New** — covers new shared helper |
| `prepare-swap.test.ts` | 11 | Unchanged |
| `prepare-enter-strategy.test.ts` | 10 | Passes unchanged after refactor |
| `prepare-exit-strategy.test.ts` | 12 | Unchanged |
| `prepare-claim-rewards.test.ts` | 8 | Unchanged |
| `get-quote.test.ts` | 15 | Extended with 7 new `stable: "auto"` cases |
| `routes.test.ts` | 16 | Integration — unchanged |
| Foundry (PanoramaExecutor + DCAVault) | 57 | Updated for new `execute()` API |
| **Total** | **194** | **100% passing** |

---

## Architecture After Refactor

```
POST /provider/swap/quote    ─┐
POST /provider/swap/prepare  ─┤ swap-provider.usecase.ts
                              │  (shape mapping only)
                              │  ↓ delegates to
POST /swap/quote    ──────────┼─ get-quote.usecase.ts       ← canonical, owns best-of-two
POST /swap/prepare  ──────────┼─ prepare-swap.usecase.ts    ← canonical
                              │      ↓ uses
                              └─ shared/aerodrome-swap.ts   ← bundle helper

POST /staking/prepare-enter ── prepare-enter-strategy.usecase.ts
                                   ↓ uses
                               shared/aerodrome-add-liquidity.ts  ← new bundle helper
```

**Adding a new protocol (e.g. Velodrome on Optimism):**
1. Deploy `VelodromeAdapter` implementing `IProtocolAdapter`
2. `executor.registerAdapter(keccak256("velodrome"), addr)`
3. `registerProtocol("velodrome", { ... })` in `backend/src/config/protocols.ts`
4. Zero changes to `PanoramaExecutor`, `BundleBuilder`, or any existing module
