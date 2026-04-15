# ADR 0001 — Action Family Interfaces

- **Status:** Accepted
- **Date:** 2026-04-14
- **Owner:** Execution Layer
- **Related issue:** #479

## Context

The execution layer hosts a growing set of protocol adapters that each expose their own
external surface to `PanoramaExecutorV2`:

- Aerodrome (Base) — AMM + gauges
- Trader Joe V1 (Avalanche) — AMM
- Benqi Finance (Avalanche) — Compound-fork money market
- sAVAX (Avalanche) — liquid staking with cooldown
- Moonwell, Metronome, Pharaoh, … (planned)

Without shared type contracts, every new adapter risks diverging from its siblings — method
names, parameter ordering, return-value conventions — which increases both integration cost
on the backend (`BundleBuilder`, `ADAPTER_SELECTORS`) and review cost for security audits.

At the same time, the adapters **already work in production** and the executor is strictly
protocol-neutral (blind dispatch via `proxy.call(action ++ data)`). Any standardization effort
must be **purely additive**: it cannot change the executor, cannot reorder storage, and cannot
break the bundle builder.

## Problem

How do we codify the taxonomy of *action families* (SWAP, LP, LEND, STAKE) in Solidity
without forcing every existing adapter into a signature straightjacket that its upstream
protocol cannot support?

Example of friction:

- `AerodromeAdapterV2.swap(tokenIn, tokenOut, amountIn, amountOutMin, recipient, bool stable)`
- `TraderJoeAdapter.swap(tokenIn, tokenOut, amountIn, amountOutMin, recipient)` + `swapWithPath(...)`

A strict `ISwapAdapter.swap(...)` interface would have to pick one shape and break the other.
Same story for LP: Aerodrome's `addLiquidity` takes a `bool stable`; Trader Joe V1 does not.

Conversely, lending (Compound fork) and cooldown-based liquid staking (sAVAX / Lido queue)
have **stable, well-known** surfaces that *should* be locked down:

- `supply / redeem / borrow / repay / enterMarkets / exitMarket` — Compound has been the
  reference for 6+ years
- `stake / requestUnlock / redeem` — every queue-based LSD looks the same

## Decision

Adopt a **hybrid strict/marker** strategy for action-family interfaces:

### Strict interfaces (enforce exact shape)

Used when the protocol surface is *de facto* standardized by the reference implementation.

#### `ILendAdapter` — Compound-fork money markets
```solidity
function supply(address market, uint256 amount, address recipient) external returns (uint256);
function redeem(address market, uint256 receiptAmount, address recipient) external returns (uint256);
function borrow(address market, uint256 amount, address recipient) external;
function repay(address market, uint256 amount) external;
function enterMarkets(address[] calldata markets) external;
function exitMarket(address market) external;
```

Implemented by `BenqiLendAdapter` today. Moonwell (Compound fork on Base) drops in directly.
Native-asset variants (`supplyAVAX`, `borrowETH`, …) remain adapter-specific since each
Compound fork wraps the native side differently.

#### `IStakeAdapter` — cooldown-based liquid staking
```solidity
function stake(address recipient) external payable returns (uint256);
function requestUnlock(uint256 sharesAmount) external returns (uint256 unlockIndex);
function redeem(uint256 unlockIndex, address recipient) external;
```

Implemented by `SAVAXAdapter`. Future Lido/stETH queue adapter, Rocket Pool, Ankr — all same
shape.

### Marker interfaces (tag without constraint)

Used when real protocol surfaces genuinely diverge and a common signature would either lose
information or force awkward overloads.

#### `ISwapAdapter`
Empty. Tags any adapter that performs token-for-token swaps. Aerodrome's `stable` bool and
Trader Joe's multi-hop `path[]` stay as native, typed methods on the concrete adapter — the
backend (`ADAPTER_SELECTORS`) resolves them via full Solidity selector.

#### `ILPAdapter`
Empty. Tags any adapter that manages AMM positions (add / remove / stake / unstake). Again,
`bool stable` on Aerodrome and the lack thereof on Trader Joe would require a lowest-common-
denominator signature that loses fidelity.

## Consequences

### Positive

- **Categorization in code.** Every adapter declares its action families via `is IXxxAdapter`,
  so static analysis tools, audit checklists, and the backend's type system can bucket them.
- **No big-bang refactor.** All four existing adapters keep their current methods; the only
  diff is inheritance + `override` keywords where applicable.
- **Progressive tightening.** If Aerodrome V3 and Trader Joe V2 both move to the same
  Uniswap-V4-style router, we can promote `ISwapAdapter` to a strict interface later without
  changing the marker-contract history.
- **Room for native-asset variants.** `supplyAVAX`, `supplyETH`, `stake` with `msg.value` —
  all stay on concrete adapters without polluting the shared interface.

### Negative / tradeoffs

- Marker interfaces alone don't prevent drift between adapters in the same family — a new
  swap adapter could invent `swap(bytes)` and still be `is ISwapAdapter`. Mitigation: the
  *backend's* `ADAPTER_SELECTORS` + `BundleBuilder` tests act as the functional contract.
- Two strictness tiers means reviewers need to know which family they're in.
- Native-asset operations (`supplyAVAX`, `borrowETH`, `stakeAVAX`) remain adapter-specific.

### Neutral

- No storage layout impact — interfaces contribute nothing to slots.
- No executor change — the executor still dispatches blindly.

## Implementation checklist

- [x] Create `contracts/interfaces/ISwapAdapter.sol` (marker)
- [x] Create `contracts/interfaces/ILPAdapter.sol` (marker)
- [x] Create `contracts/interfaces/ILendAdapter.sol` (strict)
- [x] Create `contracts/interfaces/IStakeAdapter.sol` (strict)
- [x] `AerodromeAdapterV2 is IProtocolAdapter, ISwapAdapter, ILPAdapter`
- [x] `TraderJoeAdapter is ISwapAdapter`
- [x] `BenqiLendAdapter is ILendAdapter` + `override` on the six strict methods
- [x] `SAVAXAdapter is IStakeAdapter` + `override` on the three strict methods
- [ ] `forge test -vv --no-match-path "test/fork/*"` green
- [ ] `cd backend && npm test` green

## References

- OpenZeppelin ERC-165 — precedent for marker interfaces
- Compound v2 Comptroller — reference lending surface
- Lido Withdrawal Queue — reference cooldown-stake surface
