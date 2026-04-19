# PanoramaBlock Products — Deep Technical Dive

**Audience:** engineers joining the team who need a genuine, end-to-end understanding of every
product we ship, how it maps onto the underlying DeFi primitive, which contracts execute it, and
what the data flow looks like from the user's finger to the Ethereum state root.

**Scope:** all active products on Base (8453) and Avalanche C-Chain (43114), plus the common
infrastructure that hosts them (`PanoramaExecutorV2`, `BeaconProxy`, `BundleBuilder`,
non-custodial signing flow).

**How to read this:** section 1 is the shared foundation — read it once. Sections 2–6 are
per-product deep dives, each self-contained. Section 7 covers cross-cutting concerns
(gas, slippage, deadlines, approvals) that apply to every product.

---

## Table of Contents

1. [Foundation — how any transaction gets on-chain](#1-foundation)
2. [Product: Swap](#2-swap)
3. [Product: Liquidity Pools](#3-liquidity-pools)
4. [Product: Lending](#4-lending)
5. [Product: Liquid Staking](#5-liquid-staking)
6. [Product: DCA (Dollar-Cost Averaging)](#6-dca)
7. [Cross-cutting concerns](#7-cross-cutting)
8. [Planned products (roadmap-aware summary)](#8-planned)

---

<a id="1-foundation"></a>
## 1. Foundation — how any transaction gets on-chain

### 1.1 The non-custodial contract

Every single user action in PanoramaBlock obeys the same rule: **we never hold user keys, and
we never sign transactions on the user's behalf.** The backend only *prepares* transaction
bundles; the user's wallet signs and broadcasts them. This is non-negotiable and shapes every
design decision downstream.

This matters because it:

- Eliminates regulatory custodian obligations.
- Makes us immune to the "backend operator steals funds" attack class.
- Forces us to produce bundles that are auditable offline by the user's wallet.

### 1.2 The three-layer transaction pipeline

```
┌────────────────┐    1. HTTP request       ┌─────────────────┐
│   Frontend     │ ───────────────────────▶ │    Backend      │
│ (miniapp /     │                          │ (execution-     │
│  Telegram UI)  │ ◀─────────────────────── │  layer API)     │
│                │    2. PreparedBundle     │                 │
└───────┬────────┘                          └─────────────────┘
        │
        │ 3. user signs each tx in order
        │    (ethers / ThirdWeb / MetaMask)
        │
        ▼
┌────────────────────────────────────────────────────────────┐
│                      Blockchain                            │
│  ┌──────────────────┐      ┌───────────────────────────┐   │
│  │ PanoramaExecutor │ ───▶ │  BeaconProxy (per user,   │   │
│  │       V2         │      │  per protocol)            │   │
│  └──────────────────┘      └──────────────┬────────────┘   │
│                                           │                │
│                                           ▼                │
│                          ┌─────────────────────────────┐   │
│                          │  Underlying DeFi protocol   │   │
│                          │  (Aerodrome, Benqi, …)      │   │
│                          └─────────────────────────────┘   │
└────────────────────────────────────────────────────────────┘
```

Every bundle is a **sequence of `PreparedTransaction`s**. A typical one has two:

1. `approve(spender, amount)` — only if current allowance < required (`addApproveIfNeeded`)
2. `execute(protocolId, action, transfers, deadline, data)` — the real operation

Some products (Swap ERC20→ETH) only need step 2 because the approve was done previously. Some
products need three or four steps (LP: approve tokenA, approve tokenB, addLiquidity, stake in
gauge).

### 1.3 `PanoramaExecutorV2` — the only entry point

```solidity
function execute(
    bytes32 protocolId,
    bytes4  action,
    Transfer[] calldata transfers,
    uint256 deadline,
    bytes calldata data
) external payable returns (bytes memory result)
```

The executor is **protocol-neutral by design**. It knows nothing about swaps, lending, or
staking. It only does three things:

1. **Resolve or create** the user's `BeaconProxy` for `protocolId`. Addresses are deterministic
   — `CREATE2` with salt = `keccak256(user, protocolId)`. The same user + protocol always
   resolves to the same proxy.
2. **Pull tokens** from the user into their proxy via `transferFrom` (the user already
   approved the executor in step 1 of the bundle).
3. **Low-level call** `proxy.call(action ++ data)` — blind dispatch.

This design means: *adding a new protocol never requires changing the executor*. You deploy the
adapter, deploy an `UpgradeableBeacon`, call `registerBeacon()`, and the executor serves it
immediately.

### 1.4 `BeaconProxy` and why we use it (not EIP-1167 clones)

Each protocol has **one `UpgradeableBeacon`**. The beacon stores a single address: the current
adapter implementation. Each user has **one `BeaconProxy` per protocol** they've touched. That
proxy delegates every call to `beacon.implementation()`.

Upgrading from adapter v1 to adapter v2 is **one transaction**:

```solidity
beacon.upgradeTo(newAdapterImplementation);
```

All user proxies for that protocol immediately point to the new implementation. No user
migration, no gas cost per user.

Why not EIP-1167 (minimal proxy clones, our V1 approach)? EIP-1167 hardcodes the
implementation address into the proxy's bytecode. Upgrading would require **redeploying every
user's proxy** — impossible at scale. BeaconProxy costs ~30 gas more per call (one extra
`SLOAD`), in exchange for total upgrade flexibility.

### 1.5 Adapter conventions (V2)

Every adapter MUST:

- Inherit `Initializable` from OpenZeppelin (prevents double-init).
- Expose `function initializeFull(address _executor, bytes calldata _initArgs)`.
- Have `modifier onlyExecutor` guarding every state-mutating external function.
- Reserve `uint256[50] private __gap` at the tail of storage.
- Accept native asset: `receive() external payable {}`.

Why `__gap[50]`? So we can add new state variables in V3 without shifting existing slots.
Storage-layout compatibility is the single hardest constraint in upgradeable contracts — reorder
one slot and every user's proxy reads garbage.

### 1.6 `BundleBuilder` — the only place bundles are assembled

Location: [`backend/src/shared/bundle-builder.ts`](../../backend/src/shared/bundle-builder.ts).

```typescript
const bundle = new BundleBuilder(chainId)
  .addApproveIfNeeded(token, spender, currentAllowance, required, "Approve USDC")
  .addExecute(
    protocolId,
    ADAPTER_SELECTORS.SWAP,
    transfers,
    deadline,
    adapterData,
    msgValue,
    executorAddress,
    "Swap USDC for AVAX"
  )
  .build("Swap 100 USDC → AVAX on Trader Joe");
```

Rule: **never construct a `PreparedTransaction` manually anywhere else.** This is what keeps
the bundles auditable. Every module goes through the same builder, so the frontend always sees
the same shape: `{ transactions: [...], summary, metadata }`.

The selector comes from a registry:

```typescript
ADAPTER_SELECTORS.SWAP_AERODROME = ethers.id(
  "swap(address,address,uint256,uint256,address,bool)"
).slice(0, 10);
```

Full Solidity signature is mandatory — `ethers.id("swap")` is a different hash.

### 1.7 `adapterData` — tight ABI encoding, no selector

Adapter `data` is the ABI-encoded argument tuple of the adapter function, **without** the
4-byte selector (the executor already passed the selector via `action`):

```typescript
const adapterData = ethers.AbiCoder.defaultAbiCoder().encode(
  ["address", "address", "uint256", "uint256", "address", "bool"],
  [tokenIn, tokenOut, amountIn, amountOutMin, recipient, stable]
);
```

Inside `execute()`:

```solidity
(bool ok, bytes memory result) = proxy.call(abi.encodePacked(action, data));
```

Note `encodePacked` — the selector is prepended to the encoded args. The proxy receives a
standard Solidity calldata layout.

---

<a id="2-swap"></a>
## 2. Product: Swap

### 2.1 DeFi primitive explained

An **AMM** (Automated Market Maker) swap replaces traditional order books with a liquidity
pool. Each pool holds reserves of two tokens and enforces an invariant:

- **Constant product (volatile pools):** `x * y = k`. Uniswap V2, Aerodrome volatile, Trader
  Joe V1. Price slips quadratically with trade size.
- **Stable pools (StableSwap curve):** `x + y = k` approximation at equilibrium, transitions to
  constant product at extremes. Curve, Aerodrome stable pools. Minimal slippage for correlated
  assets (USDC↔USDT, ETH↔wstETH).

The user gets no price guarantee — they specify `amountOutMin`, and the trade reverts if the
actual output would be below this threshold. Slippage protection is the user's job (and we
calculate it for them).

### 2.2 Swap on Base — Aerodrome Finance

**Protocol:** Aerodrome Finance (Velodrome V2 fork on Base, VE(3,3) model).

**Router:** `0xcF77a3Ba9A5CA399B7c97c74d54e5b1Beb874E43`

**Our adapter:** [`AerodromeAdapterV2`](../../contracts/aerodrome/adapters/AerodromeAdapterV2.sol)
→ implements `ISwapAdapter` (marker) + `ILPAdapter` (marker).

**Adapter function:**

```solidity
function swap(
    address tokenIn,
    address tokenOut,
    uint256 amountIn,
    uint256 amountOutMin,
    address recipient,
    bool stable                  // <— Aerodrome-specific: picks stable vs volatile pool
) external payable onlyExecutor returns (uint256 amountOut)
```

Internally it builds a single-hop `IAerodromeRouter.Route`:

```solidity
routes[0] = IAerodromeRouter.Route({
    from: tokenIn,
    to: tokenOut,
    stable: stable,              // routes through either x*y=k or StableSwap
    factory: factory             // Aerodrome pool factory
});
```

If `tokenIn == address(0)`, adapter uses `swapExactETHForTokens` (msg.value-based). If
`tokenOut == address(0)`, uses `swapExactTokensForETH`. Else `swapExactTokensForTokens`.

**Backend module:** [`modules/swap/`](../../backend/src/modules/swap/).

**Use cases:**
- `get-quote.usecase.ts` — calls `router.getAmountsOut(amountIn, routes)`, returns expected output
- `get-swap-pairs.usecase.ts` — lists all available volatile + stable pairs
- `prepare-swap.usecase.ts` — builds the bundle

**End-to-end flow (user wants to swap 100 USDC → AERO on Base):**

1. **Frontend** calls `POST /modules/swap/quote` with `{ chainId: 8453, tokenIn: USDC, tokenOut: AERO, amountIn: 100e6 }`.
2. **Backend** queries `AerodromeRouter.getAmountsOut()` for both volatile and stable pools,
   picks the pool with better output, calculates `amountOutMin = expected * (1 - slippageBps/10000)`.
3. **Frontend** shows quote, user clicks confirm.
4. **Frontend** calls `POST /modules/swap/prepare-swap` with the user's address and signed
   slippage tolerance.
5. **Backend** checks current USDC→executor allowance on-chain. If insufficient, `BundleBuilder`
   prepends an `approve` transaction. Then builds the `execute` transaction.
6. **Frontend** receives a bundle with 1 or 2 transactions.
7. **User signs** the first (approve) in their wallet → broadcasts → wait for confirmation.
8. **User signs** the second (execute) → broadcasts.
9. `PanoramaExecutorV2.execute()` pulls 100 USDC from user → user's AerodromeAdapterV2 proxy → `adapter.swap()` → `Router.swapExactTokensForTokens()` → AERO is sent directly to `recipient` (the user's wallet), never passes back through the proxy.
10. **Frontend** polls the tx hash, shows success.

### 2.3 Swap on Avalanche — Trader Joe V1

**Protocol:** Trader Joe V1 (classic Uniswap V2 fork, constant-product only).

**Router:** `0x60aE616a2155Ee3d9A68541Ba4544862310933d4`

**Our adapter:** [`TraderJoeAdapter`](../../contracts/avax/adapters/TraderJoeAdapter.sol)
→ implements `ISwapAdapter` (marker).

**Key difference from Aerodrome:** no `bool stable` — Trader Joe V1 has only volatile pools.
Instead, it has **path-based routing**: if neither token is WAVAX, the adapter builds a 3-hop
path (`tokenIn → WAVAX → tokenOut`).

```solidity
address[] memory path;
if (resolvedIn == wavax || resolvedOut == wavax) {
    path = new address[](2);
    path[0] = resolvedIn;
    path[1] = resolvedOut;
} else {
    path = new address[](3);
    path[0] = resolvedIn;
    path[1] = wavax;           // WAVAX as hub liquidity
    path[2] = resolvedOut;
}
```

For true multi-hop routes (like USDC → WAVAX → USDT), the adapter exposes
`swapWithPath(amountIn, amountOutMin, path[], recipient)`.

**Backend module:** [`modules/avax-swap/`](../../backend/src/modules/avax-swap/).

**Same selector pattern, different signature** — the backend registers a different selector:

```typescript
ADAPTER_SELECTORS.SWAP_TRADERJOE = ethers.id(
  "swap(address,address,uint256,uint256,address)"  // no `bool`
).slice(0, 10);
```

Notice the signature is different from Aerodrome's — that's why `ISwapAdapter` is a *marker*
and not strict. See [ADR 0001](../adr/0001-action-families.md) for the full rationale.

### 2.4 Security edges to know

- **Sandwich attacks:** a MEV bot front-runs the user's trade to move the price up, then
  back-runs to sell. Mitigation: low `amountOutMin` tolerance (typical: 0.5%), small trades.
- **Deadline:** `block.timestamp + 300` in the adapter. After 5 min, the trade is no longer
  valid — prevents a pending tx from executing at a stale price.
- **Price impact** on low-liquidity pools: we calculate it in the backend quote and show it in
  the UI so the user can abort.

---

<a id="3-liquidity-pools"></a>
## 3. Product: Liquidity Pools

### 3.1 DeFi primitive explained

**LP (Liquidity Provisioning):** deposit equal-value amounts of two tokens into a pool. In
return, receive **LP tokens** representing your share of the pool. You earn:

- **Trading fees:** every swap routes through the pool; a fee (0.05%–1%) accrues to LPs
  proportional to their share.
- **Reward emissions** (optional): in ve(3,3) systems like Aerodrome, gauges emit protocol
  tokens (AERO) to LPs who **stake their LP tokens in the gauge**. This is additional yield on
  top of trading fees.

**The three-step flow:**

1. `addLiquidity(tokenA, tokenB, amountA, amountB)` → receives LP tokens
2. `gauge.deposit(lpTokens)` → stakes them in the gauge → earns AERO emissions
3. Later: `gauge.getReward()` → claims accumulated AERO

**Impermanent loss (IL):** if token A moons and B stays flat, the pool rebalances and you end
up with less A than if you had just held. The pool fees need to outweigh IL for LP to be
profitable. This is the user's risk, not ours.

### 3.2 LP on Base — Aerodrome

**Contracts involved (real Aerodrome infrastructure):**

- **Router2:** enters `addLiquidity` / `removeLiquidity`
- **Pool factory:** deploys pools deterministically from `(tokenA, tokenB, stable)`
- **Voter:** maps `pool → gauge` address; also handles AERO emissions
- **Gauge:** per-pool staking contract that emits AERO rewards to stakers

**Our adapter functions** (`AerodromeAdapterV2`):

```solidity
// Mint LP tokens
function addLiquidity(
    address tokenA, address tokenB, bool stable,
    uint256 amountADesired, uint256 amountBDesired,
    uint256 amountAMin, uint256 amountBMin,
    address recipient
) external payable onlyExecutor returns (uint256 liquidity);

// Burn LP tokens
function removeLiquidity(
    address tokenA, address tokenB, bool stable,
    uint256 liquidity,
    uint256 amountAMin, uint256 amountBMin,
    address recipient, address pool
) external onlyExecutor returns (uint256 amountA, uint256 amountB);

// Stake LP in gauge to earn AERO
function stake(address lpToken, uint256 amount, address gauge)
    external onlyExecutor returns (bool);

// Unstake from gauge
function unstake(address lpToken, uint256 amount, address gauge, address recipient)
    external onlyExecutor returns (bool);

// Claim pending AERO
function claimRewards(address lpToken, address recipient, address gauge)
    external onlyExecutor returns (uint256 rewardAmount);
```

**Key implementation detail — dust refunds:**

`addLiquidity` takes `desired` amounts; the router uses only `used` amounts (depends on the
current pool ratio). The adapter **refunds the unused portion** to the user:

```solidity
(uint256 usedA, uint256 usedB, uint256 lp) = router.addLiquidity(...);
_refundIfExcess(tokenA, amountADesired, usedA, recipient);
_refundIfExcess(tokenB, amountBDesired, usedB, recipient);
```

Without this, dust accumulates in the proxy forever — tiny amounts on every addLiquidity.

**Gauge lookup:** if the frontend doesn't know the gauge address, it passes `address(0)` and
the adapter resolves via `voter.gauges(lpToken)`.

**Backend module:** [`modules/liquid-staking/`](../../backend/src/modules/liquid-staking/) —
historically named "liquid-staking" because Aerodrome gauges were the first staking-like
product we shipped, but it's semantically LP. Slated for rename to `modules/base-lp/`.

Use cases:
- `get-staking-pools.usecase.ts` — enumerates all active gauges
- `get-position.usecase.ts` — returns (LP balance, gauge balance, pending AERO)
- `prepare-enter-strategy.usecase.ts` — addLiquidity → stake in gauge (two-step bundle)
- `prepare-exit-strategy.usecase.ts` — unstake → removeLiquidity
- `prepare-claim-rewards.usecase.ts` — claim AERO

### 3.3 LP on Avalanche — Trader Joe (planned)

Trader Joe V1 has LP pools but the current `TraderJoeAdapter` only ships swap. Adding LP is
task #XXX (Rizzi) and will mirror the Aerodrome shape minus the `bool stable` and minus the
gauge layer. Trader Joe V1 has no native VE-style emissions; yield comes from trading fees
only. V2 Liquidity Book has **bin-based concentrated liquidity** — a different beast. We're
scoping V1 for the first pass.

### 3.4 Risks to communicate

- **IL:** front-end must show estimated IL at current price vs. baseline.
- **Rebase tokens** (stETH-like): unless protocol supports them, they will break LP math.
  Aerodrome does NOT. We filter them out of the pair list.
- **Gauge-less pools:** some pools exist but have no gauge — no AERO emissions. We label them.

---

<a id="4-lending"></a>
## 4. Product: Lending

### 4.1 DeFi primitive explained

**Money market** = pooled lending. Suppliers deposit tokens into a shared pool, borrowers
take from the same pool, and rates adjust algorithmically based on utilization.

Three mechanics to internalize:

1. **Receipt tokens (cTokens, qTokens, mTokens):** when you supply USDC to Benqi, you get
   `qiUSDC`. It's rebasing-free: the quantity stays constant but its exchange rate with
   underlying USDC goes up over time (1 qiUSDC → 1.02 USDC after a year of interest). This is
   called a "rate-based" rebase, vs. Aave's "token-based" rebase (aUSDC balance itself grows).
2. **Collateral factor:** each market has a max borrow power (e.g., 75% for USDC, 60% for
   AVAX). If you supply $1000 USDC, you can borrow up to $750 against it.
3. **Liquidations:** if your account falls below the collateral factor threshold, anyone can
   call `liquidateBorrow()` on your position, buying your collateral at a discount (5–8%).

Interest accrues **per block** via `accrueInterest()` — usually called automatically by
`supply`/`borrow`/`repay` (they all trigger it first).

### 4.2 Lending on Avalanche — Benqi Finance

**Protocol:** Benqi Finance (Compound V2 fork).

**Comptroller:** `0x486Af39519B4Dc9a7fCcd318217352830E8AD9b4` — risk engine, holds collateral
factors, decides who can borrow how much, triggers liquidations.

**qTokens:**
- `qiAVAX`: `0x5C0401e81Bc07Ca70fAD469b451682c0d747Ef1c` (special — native AVAX)
- `qiUSDC`, `qiUSDT`, `qiDAI`, `qiBTC.b`, `qiETH` (normal ERC20 qTokens)

Native AVAX requires a separate ABI (`IBenqiAVAX`) because `mint()` is `payable` with
`msg.value` instead of an `amount` parameter.

**Our adapter:** [`BenqiLendAdapter`](../../contracts/avax/adapters/BenqiLendAdapter.sol) →
implements `ILendAdapter` **strict**.

**Strict interface methods:**

```solidity
function supply(address qToken, uint256 amount, address recipient) returns (uint256 qTokensMinted);
function redeem(address qToken, uint256 qTokenAmount, address recipient) returns (uint256 underlyingReceived);
function borrow(address qToken, uint256 amount, address recipient);
function repay(address qToken, uint256 amount);
function enterMarkets(address[] calldata qTokens);
function exitMarket(address qToken);
```

**Adapter-specific (native AVAX) — NOT in the interface, because every Compound fork wraps the
native side differently:**

```solidity
function supplyAVAX(address recipient) external payable returns (uint256 qTokensMinted);
function redeemAVAX(uint256 qTokenAmount, address recipient) external;
function borrowAVAX(uint256 amount, address recipient) external;
function repayAVAX() external payable;
```

**Where qTokens live:**

The user's **proxy** holds the qTokens — NOT the user's wallet. Why? Because qTokens act as
collateral via the Comptroller's `enterMarkets()`, and `msg.sender` must be the address that
borrows. If qTokens were in the user's wallet, the adapter couldn't borrow against them.

Concretely:

```
User → Executor → BenqiLendAdapter proxy
                   └── holds qiUSDC         (collateral)
                   └── called enterMarkets  (marks qiUSDC as collateral)
                   └── borrow qiAVAX        (proxy is the borrower of record)
                   └── transfer AVAX to user wallet  (via recipient)
```

This is the *whole reason* each user has their own proxy. A shared adapter would mean every
user's collateral is entangled.

**Backend module:** [`modules/avax-lending/`](../../backend/src/modules/avax-lending/).

Use cases: `prepare-supply`, `prepare-redeem`, `prepare-borrow`, `prepare-repay`.

**Bundle example — user borrows 1 AVAX against 2000 USDC supplied:**

```
Tx1: approve(USDC, executor, 2000 USDC)           [if allowance < 2000]
Tx2: execute(benqi, SUPPLY, [{USDC, 2000}], ...)  → qiUSDC minted into proxy
Tx3: execute(benqi, ENTER_MARKETS, [], ..., [qiUSDC, qiAVAX])
Tx4: execute(benqi, BORROW_AVAX, [], ..., amount=1 AVAX)  → native AVAX to user
```

Steps 2–4 can be combined into one `supply → enterMarkets → borrow` bundle, but each is its
own `execute()` call (the executor is stateless).

### 4.3 Lending on Base — Moonwell (planned)

**Issue #XXX (Rizzi).** Moonwell is a Compound V2 fork on Base + Moonbeam. The adapter will be
a 1:1 copy of `BenqiLendAdapter` with different addresses — because both protocols inherit the
same ABI. That's exactly what `ILendAdapter` strict was designed for.

**Moonwell Comptroller:** `0xfBb21d0380beE3312B33c4353c8936a0F13EF26C`.
**mTokens:** `mUSDC`, `mETH`, `mcbETH`, `mwstETH`.

### 4.4 Risk primer

- **Liquidation cascade:** if market prices move fast, liquidations chain: your health factor
  drops below 1 → liquidator takes 5–8% of your collateral → your position shrinks → remaining
  health ratio might still be bad → another liquidation.
- **Oracle risk:** Benqi uses Chainlink. If the oracle flash-updates, everyone's health
  recalculates in one block. A 10% price move can trigger thousands of liquidations.
- **Utilization cap:** if utilization = 100% (nobody can withdraw), the interest rate spikes to
  double-digits/day. Common reason: borrowed tokens are being held as collateral somewhere
  else.

---

<a id="5-liquid-staking"></a>
## 5. Product: Liquid Staking

### 5.1 DeFi primitive explained

"Liquid staking" = stake native asset with a validator / protocol, and receive a
**transferable receipt token** representing your staked position. The receipt token can be
used in DeFi (as collateral, in LP pools) while the underlying is still earning staking
rewards.

Two sub-types:

1. **Rebase tokens** (stETH, rETH): balance grows with accrued rewards. Share count stays
   constant. Harder for DeFi protocols to support (balance changes without a `Transfer` event).
2. **Rate-based tokens** (sAVAX, cbETH, wstETH): balance stays constant, exchange rate grows.
   Easier to integrate.

Both have **cooldown periods** for unstaking (protocols need to exit validators):
- Lido (ETH): 1–5 days via the withdrawal queue
- sAVAX: **15 days** for unstake + 2 days for redemption window
- Rocket Pool: 0–28 days

### 5.2 Liquid Staking on Avalanche — BENQI sAVAX

**Protocol:** BENQI Liquid Staked AVAX.

**sAVAX contract:** `0x2b2C81e08f1Af8835a78Bb2A90AE924ACE0eA4bE` — rate-based ERC20. 1 sAVAX
redeems for more AVAX over time.

**Our adapter:** [`SAVAXAdapter`](../../contracts/avax/adapters/SAVAXAdapter.sol) →
implements `IStakeAdapter` **strict**.

**Strict interface methods:**

```solidity
function stake(address recipient) external payable returns (uint256 sharesReceived);
function requestUnlock(uint256 sharesAmount) external returns (uint256 unlockIndex);
function redeem(uint256 unlockIndex, address recipient) external;
```

**The 15-day cooldown — why it shapes the contract:**

A naive design would be:
1. User transfers sAVAX to adapter
2. Adapter calls `sAVAX.requestUnlock(amount)` → sAVAX is queued for redemption
3. Wait 15 days
4. Adapter calls `sAVAX.redeem(index)` → gets AVAX back

Problem: sAVAX's internal unlock index is **per-caller** (i.e., `address(adapter)`). If many
users share one adapter, their unlock queues overlap. User A's unlock index 3 might redeem
user B's AVAX.

Our solution: **one BeaconProxy per user**. Since each user has their own proxy, each proxy
has its own unlock index space. The adapter stores a local `uint256[] _unlockIndices` array
and maps user-level indices to protocol-level indices:

```solidity
uint256 contractIndex = sAvax.getUnlockRequestCount(address(this));
sAvax.requestUnlock(sAvaxAmount);
unlockIndex = _unlockIndices.length;
_unlockIndices.push(contractIndex);  // our local index → protocol's internal index
```

On redeem, we swap-and-pop the local array to avoid gaps. This is the *structural* reason
BeaconProxy matters for liquid staking: sharing state would be catastrophic.

**Backend module:** [`modules/avax-liquid-staking/`](../../backend/src/modules/avax-liquid-staking/).

Use cases: `prepare-stake`, `prepare-request-unlock`, `prepare-redeem`.

**Full user flow (stake 10 AVAX, wait 15 days, get AVAX back):**

1. User calls `POST /modules/avax-liquid-staking/prepare-stake` with `amount: 10 AVAX`.
2. Bundle: **one** tx → `execute(sAvax, STAKE, [], deadline, abi.encode(user))` with `msg.value = 10 AVAX`.
3. `SAVAXAdapter.stake(recipient=user)` calls `sAvax.submit{value: 10 AVAX}()` → mints ~9.8 sAVAX (AVAX accrues yield even while staked, exchange rate > 1).
4. Adapter transfers 9.8 sAVAX → user wallet directly (`recipient = user` means we don't hold in proxy).
5. **Days later — user wants to unstake.**
6. User calls `POST /modules/avax-liquid-staking/prepare-request-unlock` with `shares: 9.8 sAVAX`.
7. Bundle has two transactions: (a) approve sAVAX to executor, (b) execute → `requestUnlock`.
8. User signs both. Adapter pulls sAVAX into proxy, calls `sAvax.requestUnlock(9.8)`. Protocol queues the unlock, our proxy stores the local index (e.g., `0`).
9. **15-day cooldown starts.**
10. After 15 days: user calls `POST /modules/avax-liquid-staking/prepare-redeem` with `unlockIndex: 0`.
11. Bundle: one tx → `execute(sAvax, REDEEM, [], ..., abi.encode(0, user))`.
12. Adapter calls `sAvax.redeem(contractIndex)` → receives ~10.1 AVAX (15 days of rewards) → forwards to user via `call{value: ...}`.

### 5.3 Liquid Staking on Base — Aerodrome gauges (current) / Lido (planned)

On Base, we currently ship **Aerodrome gauge staking** under the "liquid-staking" module name
— semantically this is LP yield farming, not liquid staking. Renaming is queued.

**Actual Lido stETH / wstETH integration on Base is planned** (via the L2 bridged stETH).
Would be a new adapter implementing `IStakeAdapter`, same shape as `SAVAXAdapter` — the
withdrawal queue works the same (request → cooldown → redeem).

### 5.4 Risks

- **Slashing:** underlying validator misbehaves → LST's exchange rate drops. Benqi's sAVAX has
  never been slashed (as of 2026-04).
- **De-pegging:** LST secondary market price can diverge from redemption value during stress
  (cf. stETH ~94% of ETH during May 2022). Matters if user wants to exit quickly — they'll
  swap sAVAX for AVAX rather than wait 15 days.

---

<a id="6-dca"></a>
## 6. Product: DCA (Dollar-Cost Averaging)

### 6.1 DeFi primitive explained

**DCA** = automatically swap a fixed amount of tokenIn → tokenOut at a fixed interval,
regardless of price. Classic long-horizon investment strategy (e.g., "buy $50 of ETH every
Monday").

Two architectural patterns:

- **Off-chain scheduling:** a backend cron triggers user swaps. Requires custodial keys OR
  delegated signatures. Simple but trust-heavy.
- **On-chain vault:** user deposits tokenIn into a vault, a *permissionless* keeper triggers
  execution. The vault checks `interval` elapsed, pulls `amountPerSwap` from balance, calls
  the swap router, forwards tokenOut to user. Non-custodial.

We use **hybrid**: on-chain `DCAVault` holds user balances and enforces interval timing; a
backend keeper (off-chain) calls `execute(orderId)` at each interval. The keeper has no
privileged access to user funds beyond triggering the pre-approved swap.

### 6.2 DCA on Base — `DCAVault`

**Contract:** [`DCAVault.sol`](../../contracts/aerodrome/core/DCAVault.sol). Singleton,
UUPS-upgradeable, deployed at `0x...` on Base.

**Note — not a user-proxy:** the vault is **shared** across all users (singleton). State is
per-order, not per-user-proxy. This is because DCA is stateless from the protocol perspective
— the vault just routes swap intents. No per-user collateral entanglement.

**Order struct:**

```solidity
struct Order {
    address owner;
    address tokenIn;
    address tokenOut;
    uint256 amountPerSwap;
    uint256 interval;
    uint256 lastExecuted;
    uint256 remainingSwaps;   // 0 = unlimited
    uint256 balance;
    bool stable;
    bool active;
}
```

**Flow:**

1. `createOrder(tokenIn, tokenOut, amountPerSwap, interval, remainingSwaps, stable, initialDeposit)`
   — user deposits `initialDeposit` tokenIn and registers order `orderId`.
2. `deposit(orderId, amount)` — top up balance (optional).
3. `keeper.execute(orderId)` — callable only by `keeper` address. Checks:
   - `order.active == true`
   - `block.timestamp >= order.lastExecuted + order.interval`
   - `order.balance >= order.amountPerSwap`
   - Then: approve executor, call `executor.executeSwapFor(order.owner, ...)`, reduce balance,
     update `lastExecuted`, decrement `remainingSwaps` if bounded.
4. `cancel(orderId)` — user marks order inactive.
5. `withdraw(orderId)` — user pulls remaining balance back.

**Safety mechanisms:**
- Keeper and executor changes use **propose/accept with 1-day delay** (`ADMIN_DELAY`).
- Swap revert reasons bubble up verbatim — keeper sees the actual cause of failure.
- `tokenOut` is sent directly to `order.owner`, never trapped in the vault.

**Why not BeaconProxy?** DCAVault is a different architectural class — it's an *orchestrator*,
not a per-user proxy. It's UUPS-upgradeable (one contract, owner-triggered upgrade). The
BeaconProxy pattern is for adapters where each user needs isolated state.

**Special integration with `PanoramaExecutorV2`:**

The executor has an `authorizedOperators` whitelist. `DCAVault` is on it, which lets the vault
call `executor.executeSwapFor(user, ...)` — a variant of `execute` that specifies *whose* proxy
to use (since the caller isn't the user).

**Backend module:** [`modules/dca/`](../../backend/src/modules/dca/).

Use cases:
- `prepare-create-order.usecase.ts` — builds bundle: approve tokenIn → createOrder
- `prepare-cancel-order.usecase.ts` — bundle: cancel → withdraw
- `get-orders.usecase.ts` — read user's active orders (by event scanning or direct call)
- `get-executable-orders.usecase.ts` — for the keeper: lists orders ready to execute

**The keeper** is a separate process (node-cron) that polls `get-executable-orders`,
constructs the execute tx, signs with its private key, and broadcasts. The keeper wallet needs
AVAX/ETH for gas but cannot steal user funds — `execute()` is parameter-rigid.

### 6.3 Future: multi-protocol DCA (Masqueico's task)

The current DCAVault only wraps **Aerodrome swap** on Base. Planned extension: `actionType`
enum on Order struct — `SWAP | LEND_SUPPLY | STAKE`. User can then DCA into Benqi (supply USDC
every week) or sAVAX (stake AVAX monthly) on Avalanche. Requires an Avalanche counterpart to
DCAVault and corresponding backend module changes.

### 6.4 Risks

- **Keeper unavailability:** if the keeper process dies, orders won't execute on time. Orders
  aren't lost — balance is safe — but swaps are delayed until keeper restart.
- **Price manipulation at keeper call time:** small pools could be sandwiched. We set
  `amountOutMin` using `get-quote` at execution time with 0.5% slippage. High-volume pools
  only.
- **Batch execution:** if 100 orders are ready at the same tick, keeper calls them serially.
  At high scale, we may need a batch executor.

---

<a id="7-cross-cutting"></a>
## 7. Cross-cutting concerns

### 7.1 Approvals (`addApproveIfNeeded`)

Every ERC20 transfer from user to executor requires prior approval. The `BundleBuilder` method
`addApproveIfNeeded(token, spender, currentAllowance, required, description)` prepends an
`approve` tx **only if `currentAllowance < required`**.

To minimize future approvals, we approve **max uint256** (`type(uint256).max`). Tradeoffs:
- Pro: one approve lasts forever for that (user, token, spender) tuple.
- Con: if the executor is ever exploited, attacker can drain the user's tokens of that type
  against the max approve. Mitigation: we use **two-step ownership + beacon removal delay**
  for the executor, and periodic security audits.

### 7.2 Slippage

Frontend sends slippage in bps (basis points, 1/100th of 1%). Default 50 bps = 0.5%. Backend
converts:

```typescript
const amountOutMin = expected * (10000n - slippageBps) / 10000n;
```

Applied uniformly across swap, LP addLiquidity (both amountMins), DCA execution.

### 7.3 Deadlines

`deadline = block.timestamp + 300` (5 minutes). Adapter reverts if `block.timestamp > deadline`.
Prevents pending transactions from executing at stale prices — a classic MEV trap.

For DCA keeper triggers, deadline is computed fresh at the moment of keeper call.

### 7.4 Gas

Bundle transactions set `gasLimit` conservatively:

- Swap: ~300k gas
- Supply / Redeem: ~250k gas
- Borrow: ~400k (requires `enterMarkets` interaction)
- Stake (sAVAX): ~200k gas
- Request unlock: ~250k gas
- Redeem (sAVAX): ~150k gas
- LP add + stake: ~600k gas

Measured via `buildWithGas()` in `BundleBuilder`, which uses `provider.estimateGas()` and adds
a 20% safety buffer. User's wallet can still override if wanted.

### 7.5 Multi-chain routing

`backend/src/config/chains.ts` maps `chainId → { rpcUrls, executor, supportedProtocols }`.
Every module resolves `getChainConfig(chainId)` first; there is no global "default" chain.

Base (8453) and Avalanche (43114) are active. The module directory structure encodes this:

```
modules/
├── swap/            (implicitly Base — legacy naming)
├── liquid-staking/  (implicitly Base — Aerodrome gauges)
├── dca/             (implicitly Base)
├── avax-swap/       (Avalanche)
├── avax-lending/    (Avalanche)
└── avax-liquid-staking/  (Avalanche)
```

The `avax-` prefix is a temporary accommodation; plan is to rename Base modules to `base-` for
symmetry.

### 7.6 Bundle auditability — what the user sees

Every `PreparedTransaction` has:
- `to`, `data`, `value`, `gasLimit` — the raw tx
- `description` — human-readable string ("Approve USDC", "Swap 100 USDC → AVAX")
- `metadata` — optional structured data (expected amountOut, price impact, etc.)

The frontend displays descriptions in order. User can see *exactly* what they're signing:
"you're about to approve USDC and then swap 100 USDC for at least 94 AVAX on Trader Joe".

### 7.7 Error handling

Adapter errors use custom Solidity errors (`error ZeroAmount()`, `error BenqiError(uint256)`).
The executor bubbles them up. The backend decodes them and returns a 422 with a mapped error
code. Frontend has a translation table.

---

<a id="8-planned"></a>
## 8. Planned products (sprint-aware)

| Product | Chain | Protocol | Status | Notes |
| --- | --- | --- | --- | --- |
| Moonwell Lending | Base | Moonwell | Planned (#XXX, Rizzi) | `ILendAdapter` strict, Compound fork, same shape as Benqi |
| Metronome Synthetic Mint | Base | Metronome | Planned (#480, Hugo) | Needs **new family** `ISynthMintAdapter` (ADR 0002) |
| TraderJoe LP | Avax | Trader Joe V1 | Planned (#XXX, Rizzi) | Same shape as Aerodrome LP minus `bool stable` and gauges |
| Lido Stake | Base | Lido | Future | `IStakeAdapter` strict — sAVAX-shaped withdrawal queue |
| DCA Multi-Protocol | Both | DCAVault v2 | Planned (Masqueico) | Enum `actionType` on Order struct |
| Community Group Unification | — | Telegram | Planned (Hugo) | Product-side, not contract |

Moonwell and TraderJoe LP are pure copy-paste from existing adapters. Metronome requires a new
action family because synthetic-mint / CDP is architecturally distinct from lending. See
[ADR 0001 §2](../adr/0001-action-families.md) for the family-vs-family rationale.

---

## Appendix A — Deployed contract addresses (production)

**Base (8453):**
- `PanoramaExecutorV2`: see latest deploy log in `script/`
- Aerodrome Router2: `0xcF77a3Ba9A5CA399B7c97c74d54e5b1Beb874E43`
- Aerodrome Voter: `0x16613524e02ad97eDfeF371bC883F2F5d6C480A5`
- `DCAVault`: see latest deploy log

**Avalanche (43114):**
- `PanoramaExecutorV2`: see latest deploy log
- Trader Joe V1 Router: `0x60aE616a2155Ee3d9A68541Ba4544862310933d4`
- Benqi Comptroller: `0x486Af39519B4Dc9a7fCcd318217352830E8AD9b4`
- qiAVAX: `0x5C0401e81Bc07Ca70fAD469b451682c0d747Ef1c`
- sAVAX: `0x2b2C81e08f1Af8835a78Bb2A90AE924ACE0eA4bE`

## Appendix B — References

- [ADR 0001 — Action Family Interfaces](../adr/0001-action-families.md)
- [Action Families dev guide](../03-smart-contracts/action-families.md)
- [Root CLAUDE.md](../../CLAUDE.md) — canonical project rules
- [`BundleBuilder`](../../backend/src/shared/bundle-builder.ts) — source of truth for bundle assembly
- [`PanoramaExecutorV2`](../../contracts/aerodrome/core/PanoramaExecutorV2.sol) — single on-chain entry point
- Compound V2 Whitepaper — reference for `ILendAdapter` shape
- Aerodrome Finance docs — reference for VE(3,3) gauge mechanics
- BENQI sAVAX Integration Guide — reference for cooldown-based liquid staking
