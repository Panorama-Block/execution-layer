// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title IProtocolAdapter
 * @notice Action interface that all protocol adapters must implement.
 * @dev Adapters are called via low-level call(action, data) from PanoramaExecutor,
 *      where `action` is the Solidity function selector and `data` is ABI-encoded params.
 *
 *      Parameters are flat typed values — no `bytes extraData` indirection — so the
 *      executor can dispatch blindly without any knowledge of action semantics.
 *      New protocols implement these functions with their own internal logic.
 *
 *      Selectors (used by backend ADAPTER_SELECTORS):
 *        SWAP             = bytes4(keccak256("swap(address,address,uint256,uint256,address,bool)"))
 *        ADD_LIQUIDITY    = bytes4(keccak256("addLiquidity(address,address,bool,uint256,uint256,uint256,uint256,address)"))
 *        REMOVE_LIQUIDITY = bytes4(keccak256("removeLiquidity(address,address,bool,uint256,uint256,uint256,address,address)"))
 *        STAKE            = bytes4(keccak256("stake(address,uint256,address)"))
 *        UNSTAKE          = bytes4(keccak256("unstake(address,uint256,address,address)"))
 *        CLAIM_REWARDS    = bytes4(keccak256("claimRewards(address,address,address)"))
 */
interface IProtocolAdapter {
    /// @notice Execute a token swap through the underlying protocol.
    function swap(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 amountOutMin,
        address recipient,
        bool stable
    ) external payable returns (uint256 amountOut);

    /// @notice Add liquidity to a pool in the underlying protocol.
    function addLiquidity(
        address tokenA,
        address tokenB,
        bool stable,
        uint256 amountADesired,
        uint256 amountBDesired,
        uint256 amountAMin,
        uint256 amountBMin,
        address recipient
    ) external payable returns (uint256 liquidity);

    /// @notice Remove liquidity from a pool in the underlying protocol.
    /// @param pool Address of the LP token (needed to approve the router).
    function removeLiquidity(
        address tokenA,
        address tokenB,
        bool stable,
        uint256 liquidity,
        uint256 amountAMin,
        uint256 amountBMin,
        address recipient,
        address pool
    ) external returns (uint256 amountA, uint256 amountB);

    /// @notice Stake LP tokens in a gauge/farm to earn rewards.
    function stake(
        address lpToken,
        uint256 amount,
        address gauge
    ) external returns (bool success);

    /// @notice Unstake LP tokens from a gauge/farm and forward to recipient.
    function unstake(
        address lpToken,
        uint256 amount,
        address gauge,
        address recipient
    ) external returns (bool success);

    /// @notice Claim pending rewards from a gauge/farm and forward to recipient.
    function claimRewards(
        address lpToken,
        address recipient,
        address gauge
    ) external returns (uint256 rewardAmount);
}
