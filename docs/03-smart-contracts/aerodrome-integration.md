# Aerodrome Integration

## Protocol Overview

Aerodrome Finance is the dominant decentralized exchange on Base, using the ve(3,3) model (fork of Velodrome on Optimism). It supports two pool types:

- **Volatile pools**: Standard x*y=k AMM for uncorrelated pairs (e.g., WETH/USDC)
- **Stable pools**: Curve-style stableswap for correlated pairs (e.g., USDC/USDbC)

## Contract Addresses (Base Mainnet)

| Contract | Address |
|----------|---------|
| Router2 | 0xcF77a3Ba9A5CA399B7c97c74d54e5b1Beb874E43 |
| DefaultFactory | 0x420DD381b31aEf6683db6B902084cB0FFECe40Da |
| Voter | 0x16613524e02ad97eDfeF371bC883F2F5d6C480A5 |
| WETH | 0x4200000000000000000000000000000000000006 |
| USDC | 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913 |
| AERO | 0x940181a94A35A4569E4529A3CDfB74e38FD98631 |

## Router2 Interface

### Route Struct
```solidity
struct Route {
    address from;    // Input token
    address to;      // Output token
    bool stable;     // true for stable pool, false for volatile
    address factory; // Pool factory address
}
```

### Key Functions

**Swaps:**
- `swapExactTokensForTokens(amountIn, amountOutMin, Route[], to, deadline)` - ERC20 to ERC20
- `swapExactETHForTokens(amountOutMin, Route[], to, deadline)` - ETH to ERC20
- `swapExactTokensForETH(amountIn, amountOutMin, Route[], to, deadline)` - ERC20 to ETH

**Liquidity:**
- `addLiquidity(tokenA, tokenB, stable, amountADesired, amountBDesired, amountAMin, amountBMin, to, deadline)` - Add ERC20/ERC20 liquidity
- `addLiquidityETH(token, stable, amountTokenDesired, amountTokenMin, amountETHMin, to, deadline)` - Add ETH/ERC20 liquidity
- `removeLiquidity(tokenA, tokenB, stable, liquidity, amountAMin, amountBMin, to, deadline)` - Remove liquidity

**Queries:**
- `getAmountsOut(amountIn, Route[])` - Get expected output amounts
- `poolFor(tokenA, tokenB, stable, factory)` - Get pool address

## Factory

The DefaultFactory creates and tracks pools. Use `poolFor()` on the router to find a pool's address for a given pair and pool type.

## Voter (Gauge Mapping)

The Voter contract maps pool addresses to their gauge (staking) contracts:
- `gauges(pool)` - Returns the gauge address for a pool
- `isAlive(gauge)` - Checks if a gauge is active

## Gauge Interface

Gauges allow staking LP tokens to earn AERO rewards:
- `deposit(amount)` - Stake LP tokens
- `deposit(amount, recipient)` - Stake on behalf of recipient
- `withdraw(amount)` - Unstake LP tokens
- `getReward(account)` - Claim pending AERO rewards
- `earned(account)` - View pending rewards
- `balanceOf(account)` - View staked balance

## AerodromeAdapter Implementation

### Swap Handling
1. Receives generic swap parameters from PanoramaExecutor
2. Decodes `extraData` to get pool type (stable/volatile)
3. Constructs Route[] with factory address
4. Routes to appropriate swap function based on tokenIn/tokenOut:
   - ETH input: `swapExactETHForTokens`
   - ETH output: `swapExactTokensForETH`
   - ERC20/ERC20: `swapExactTokensForTokens`

### Liquidity Handling
1. Approves router for both tokens
2. Calls `router.addLiquidity()`
3. Refunds unused tokens to recipient (router may use less than desired amounts)

### Gauge Resolution
1. If gauge address provided in `extraData`, use it directly
2. If gauge is address(0), look up via `voter.gauges(lpToken)`
3. Revert if no gauge found

### Token Approval Pattern
```solidity
function _approve(address token, address spender, uint256 amount) internal {
    token.safeApprove(spender, 0);     // Reset to 0 first (required by some tokens)
    token.safeApprove(spender, amount); // Set new allowance
}
```
