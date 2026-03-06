// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title IProtocolAdapter
 * @notice Generic interface that all protocol adapters must implement.
 * @dev Each adapter wraps a specific DeFi protocol (Aerodrome, Velodrome, Trader Joe, etc.)
 *      and translates generic calls into protocol-specific interactions.
 */
interface IProtocolAdapter {
    /// @notice Execute a token swap through the underlying protocol.
    /// @param tokenIn Address of the input token (address(0) for native ETH).
    /// @param tokenOut Address of the output token.
    /// @param amountIn Amount of input tokens to swap.
    /// @param amountOutMin Minimum acceptable output amount (slippage protection).
    /// @param recipient Address to receive the output tokens.
    /// @param extraData Protocol-specific encoded data (e.g., route, pool type).
    /// @return amountOut Actual amount of output tokens received.
    function swap(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 amountOutMin,
        address recipient,
        bytes calldata extraData
    ) external payable returns (uint256 amountOut);

    /// @notice Add liquidity to a pool in the underlying protocol.
    /// @param tokenA Address of the first token.
    /// @param tokenB Address of the second token.
    /// @param stable Whether this is a stable or volatile pool.
    /// @param amountADesired Desired amount of tokenA to deposit.
    /// @param amountBDesired Desired amount of tokenB to deposit.
    /// @param amountAMin Minimum acceptable amount of tokenA.
    /// @param amountBMin Minimum acceptable amount of tokenB.
    /// @param recipient Address to receive LP tokens.
    /// @param extraData Protocol-specific encoded data.
    /// @return liquidity Amount of LP tokens received.
    function addLiquidity(
        address tokenA,
        address tokenB,
        bool stable,
        uint256 amountADesired,
        uint256 amountBDesired,
        uint256 amountAMin,
        uint256 amountBMin,
        address recipient,
        bytes calldata extraData
    ) external payable returns (uint256 liquidity);

    /// @notice Remove liquidity from a pool in the underlying protocol.
    /// @param tokenA Address of the first token.
    /// @param tokenB Address of the second token.
    /// @param stable Whether this is a stable or volatile pool.
    /// @param liquidity Amount of LP tokens to burn.
    /// @param amountAMin Minimum acceptable amount of tokenA to receive.
    /// @param amountBMin Minimum acceptable amount of tokenB to receive.
    /// @param recipient Address to receive the underlying tokens.
    /// @param extraData Protocol-specific encoded data.
    /// @return amountA Actual amount of tokenA received.
    /// @return amountB Actual amount of tokenB received.
    function removeLiquidity(
        address tokenA,
        address tokenB,
        bool stable,
        uint256 liquidity,
        uint256 amountAMin,
        uint256 amountBMin,
        address recipient,
        bytes calldata extraData
    ) external payable returns (uint256 amountA, uint256 amountB);

    /// @notice Stake LP tokens in a gauge/farm to earn rewards.
    /// @param lpToken Address of the LP token to stake.
    /// @param amount Amount of LP tokens to stake.
    /// @param extraData Protocol-specific encoded data (e.g., gauge address).
    /// @return success Whether the staking was successful.
    function stake(
        address lpToken,
        uint256 amount,
        bytes calldata extraData
    ) external returns (bool success);

    /// @notice Unstake LP tokens from a gauge/farm.
    /// @param lpToken Address of the LP token to unstake.
    /// @param amount Amount of LP tokens to unstake.
    /// @param extraData Protocol-specific encoded data (e.g., gauge address).
    /// @return success Whether the unstaking was successful.
    function unstake(
        address lpToken,
        uint256 amount,
        bytes calldata extraData
    ) external returns (bool success);
}
