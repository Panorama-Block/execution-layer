// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title ILPAdapter
 * @notice Family marker interface for protocol adapters that expose liquidity-pool
 *         actions (add/remove liquidity, gauge staking, reward claiming).
 * @dev This interface is intentionally a marker (no functions) because LP surfaces
 *      diverge between protocol families:
 *
 *        - Solidly-style (Aerodrome): `addLiquidity(...,bool stable,...)`,
 *          `stake(lpToken, amount, gauge)`, `claimRewards(lpToken, recipient, gauge)`.
 *        - UniswapV2-style (Trader Joe V1): no `stable` flag, farm staking via
 *          `MasterChef`-shaped calls.
 *        - Concentrated liquidity (UniV3, TraderJoe V2.1 liquidity book): ranges +
 *          NFT positions — incompatible with either of the above.
 *
 *      Enforcing a single strict Solidity signature would either require refactoring
 *      deployed adapters or exclude protocols whose LP surface does not match. This
 *      marker declares family membership; the concrete selectors are registered in the
 *      backend Protocol Registry per adapter.
 *
 *      Expected Solidly-style selectors (registered per adapter, not enforced on-chain):
 *        - `addLiquidity(address,address,bool,uint256,uint256,uint256,uint256,address)`
 *        - `removeLiquidity(address,address,bool,uint256,uint256,uint256,address,address)`
 *        - `stake(address,uint256,address)`
 *        - `unstake(address,uint256,address,address)`
 *        - `claimRewards(address,address,address)`
 */
interface ILPAdapter {
    // Intentionally empty — marker interface.
}
