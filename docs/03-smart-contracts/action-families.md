# Action Families — Dev Context

**Audience:** anyone adding a new protocol adapter, reviewing adapter PRs, or wiring a new
product module on the backend.

**TL;DR:** every adapter now declares which *action families* it belongs to via Solidity
interface inheritance. Some interfaces enforce a strict signature (lending, cooldown staking),
others are empty markers (swap, LP) because real protocol surfaces diverge. Full rationale in
[ADR 0001](../adr/0001-action-families.md).

---

## 1. Why this exists

Before, every adapter just inherited `Initializable` and shipped whatever methods its upstream
protocol needed. That works but:

- Two swap adapters can diverge in subtle ways (parameter order, naming), forcing the
  backend's `ADAPTER_SELECTORS` to memorize per-adapter exceptions.
- A new team member reading `BenqiLendAdapter` has no Solidity-level hint that it's a
  Compound-fork money market and that `MoonwellAdapter` should mirror its shape.
- Audits have no taxonomy to bucket adapters by capability.

Interfaces solve the second and third problem cheaply (zero runtime cost for markers, a
vtable entry or two for strict). They do not, on their own, solve the first — consistent
naming across adapters is still a PR-review concern.

## 2. The four families

Location: `contracts/interfaces/`.

| Interface         | Kind   | Methods                                                          | Implementers                  |
| ----------------- | ------ | ---------------------------------------------------------------- | ----------------------------- |
| `ISwapAdapter`    | marker | (none)                                                           | Aerodrome, Trader Joe         |
| `ILPAdapter`      | marker | (none)                                                           | Aerodrome                     |
| `ILendAdapter`    | strict | `supply / redeem / borrow / repay / enterMarkets / exitMarket`   | Benqi (Moonwell coming)       |
| `IStakeAdapter`   | strict | `stake / requestUnlock / redeem`                                 | sAVAX (Lido-style queue next) |

**Marker** = categorization only. You declare `is ISwapAdapter` to tag your adapter, but you
pick whatever swap signature your protocol needs.

**Strict** = you *must* implement the exact signatures (or the compiler rejects the
contract), and you mark them with `override`.

### When is something strict vs marker?

Rule of thumb: if the upstream protocol surface is standardized de facto across the
ecosystem, we lock it down. Compound has been the reference money-market ABI since 2019 — any
Compound fork (Benqi, Moonwell, Venus, Sonne) matches it 1:1. Lido's withdrawal queue has
become the reference cooldown-stake shape for ETH and AVAX liquid staking.

AMMs do not have this luxury — Uniswap V2, Aerodrome with its `bool stable`, Curve with
stable pools, Trader Joe V1 flat / V2 Liquidity Book — no common signature preserves all of
them without losing information.

## 3. How to add a new adapter to an existing family

### 3.1 Lending (strict `ILendAdapter`)

Example: wiring Moonwell on Base.

```solidity
import {ILendAdapter} from "../../interfaces/ILendAdapter.sol";

contract MoonwellLendAdapter is Initializable, ILendAdapter {
    // ... storage, executor, initializeFull ...

    function supply(address mToken, uint256 amount, address recipient)
        external override onlyExecutor returns (uint256) { ... }

    function redeem(address mToken, uint256 mTokenAmount, address recipient)
        external override onlyExecutor returns (uint256) { ... }

    function borrow(address mToken, uint256 amount, address recipient)
        external override onlyExecutor { ... }

    function repay(address mToken, uint256 amount)
        external override onlyExecutor { ... }

    function enterMarkets(address[] calldata mTokens) external override onlyExecutor { ... }
    function exitMarket(address mToken) external override onlyExecutor { ... }

    // Native variants (supplyETH, borrowETH) stay adapter-specific — no override.
    function supplyETH(address recipient) external payable onlyExecutor returns (uint256) { ... }
}
```

Forgetting `override` on one of the six will fail compilation. That's the point.

### 3.2 Stake (strict `IStakeAdapter`)

Cooldown-based liquid staking. Example signature template:

```solidity
function stake(address recipient) external payable override onlyExecutor returns (uint256);
function requestUnlock(uint256 sharesAmount) external override onlyExecutor returns (uint256);
function redeem(uint256 unlockIndex, address recipient) external override onlyExecutor;
```

Per-user unlock tracking should live in the adapter storage — each user has their own
BeaconProxy, so a contract-level array is effectively per-user. See
[`SAVAXAdapter.sol`](../../contracts/avax/adapters/SAVAXAdapter.sol) for the canonical
pattern.

### 3.3 Swap (marker `ISwapAdapter`)

You're free to invent the signature, but please:

- First arg is `tokenIn` (or `path[0]` when using paths).
- Always take `amountIn`, `amountOutMin`, `recipient`, in that order.
- Accept `tokenIn == address(0)` as native asset (`msg.value`) where applicable.
- Return the actual `amountOut`.
- If your protocol needs a mode flag (stable vs volatile, concentrated vs classic), add it as
  the last bool/enum arg.

Then register the selector in `backend/src/shared/bundle-builder.ts` using the full Solidity
signature:

```typescript
ADAPTER_SELECTORS.SWAP_AERODROME = ethers.id("swap(address,address,uint256,uint256,address,bool)").slice(0, 10);
ADAPTER_SELECTORS.SWAP_TRADERJOE = ethers.id("swap(address,address,uint256,uint256,address)").slice(0, 10);
```

Different selectors per adapter is fine — `PanoramaExecutorV2` dispatches blindly.

### 3.4 LP (marker `ILPAdapter`)

Same spirit as swap: declare `is ILPAdapter` to categorize, then model `addLiquidity`,
`removeLiquidity`, `stake`, `unstake` to match your protocol. See `AerodromeAdapterV2` for a
reference on refunds and gauge integration.

## 4. How to add a brand-new family

Only do this when a new protocol *class* appears that doesn't fit any existing family —
perpetuals, options, bridges, etc. Steps:

1. Propose the interface in a new ADR (`docs/adr/000N-<name>.md`).
2. Decide strict vs marker using the rubric in §2.
3. Add the interface file under `contracts/interfaces/I<Family>Adapter.sol`.
4. Update this doc's table.
5. First adapter that implements the family inherits it; rinse and repeat for future ones.

Do **not** retrofit a strict interface onto pre-existing adapters without a version bump —
promoting a family from marker to strict is a signature constraint that can break
already-deployed adapters.

## 5. Deploy procedure after adapter changes

Adding `is IXxxAdapter` + `override` does **not** change runtime behavior — only the metadata
hash at the tail of the bytecode changes. Still:

- Every mutation to an adapter's source requires a new implementation deploy.
- Proxies (user BeaconProxies) do **not** redeploy — they automatically follow the beacon.
- `PanoramaExecutorV2` does **not** redeploy.

Rollout checklist:

```bash
# 1. Deploy new implementation
forge script script/UpgradeAdapter.s.sol --rpc-url $BASE_RPC_URL --broadcast

# 2. Point the beacon at it
# Inside the script or via cast:
cast send $BEACON_ADDRESS "upgradeTo(address)" $NEW_IMPL --private-key $DEPLOYER_KEY

# 3. Verify one user proxy now reads the new impl
cast call $BEACON_ADDRESS "implementation()(address)"
```

All existing user proxies immediately delegate to the new impl. No user action required.

### Storage-layout changes — the one thing to be careful about

If you add a new state variable to an adapter:

- Append at the **end** of storage (never between existing vars).
- Reduce `__gap[50]` by the number of new slots you consumed.
- A new `uint256 foo` → `uint256[49] private __gap;`.

If you reorder or remove a storage variable: **stop, open a PR, get a review**. This is the
only class of change that can brick existing user proxies on upgrade.

## 6. Testing expectations

After any adapter change:

```bash
# Unit tests, no RPC
forge test -vv --no-match-path "test/fork/*"

# Fork tests (requires RPC)
BASE_RPC_URL=https://mainnet.base.org forge test --match-path "test/fork/*" -vvv
AVAX_RPC_URL=https://api.avax.network/ext/bc/C/rpc forge test --match-path "test/fork/*" -vvv

# Backend
cd backend && npm test
```

Minimum coverage for a new adapter:

- One unit test per strict-interface method, using mocks.
- One fork test for the happy path against the real protocol.
- If it implements a marker family, cover at least one swap / LP roundtrip on fork.

## 7. Backend integration checklist

When wiring a new adapter on the backend side:

- [ ] Register the protocol with `registerProtocol()` (id, chain, beacon address, selectors).
- [ ] Add selectors to `ADAPTER_SELECTORS` using full Solidity signatures (not just names).
- [ ] Build every bundle through `BundleBuilder` — never hand-construct `PreparedTransaction`.
- [ ] Encode `adapterData` with `ethers.AbiCoder.defaultAbiCoder().encode(types, values)` —
      types must match the adapter function's Solidity types exactly.
- [ ] Add a module under `backend/src/modules/<protocol>/` with `usecases/`, `controllers/`,
      `routes/`.

## 8. FAQ

**Q: I want to add a new lending adapter but the protocol's `supply` returns nothing — Benqi
returns a uint. Can I change the interface return type?**
A: No, because that breaks every existing implementer. Either return 0 when you have no
useful value, or bring it up for an ADR amendment.

**Q: My swap adapter needs 3 extra args (slippage curve, feeTier, recipient). Does it still
fit `ISwapAdapter`?**
A: Yes. Marker interfaces impose no signature. Just be consistent about ordering and document
the encoding in the module's `usecases/`.

**Q: Can one adapter implement two families?**
A: Yes — see `AerodromeAdapterV2 is IProtocolAdapter, ISwapAdapter, ILPAdapter`. Use
judgment: if the two surfaces are genuinely coupled (same router call site), keep them in one
adapter; if they're independent (e.g., lending + staking), split.

**Q: Do I need `override` on a marker interface?**
A: No — markers have no functions to override. You only write `override` for methods declared
in a strict parent interface.

## 9. References

- [ADR 0001 — Action Family Interfaces](../adr/0001-action-families.md)
- [`contracts/interfaces/`](../../contracts/interfaces/)
- Root [`CLAUDE.md`](../../CLAUDE.md) — canonical project rules (selectors, storage, executor)
- [`BundleBuilder`](../../backend/src/shared/bundle-builder.ts) — single bundle assembly point
