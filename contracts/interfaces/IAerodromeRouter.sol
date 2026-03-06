// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title IAerodromeRouter
 * @notice Interface for Aerodrome Finance Router2 on Base.
 * @dev Router2 address on Base mainnet: 0xcF77a3Ba9A5CA399B7c97c74d54e5b1Beb874E43
 */
interface IAerodromeRouter {
    struct Route {
        address from;
        address to;
        bool stable;
        address factory;
    }

    /// @notice Sort two token addresses.
    function sortTokens(address tokenA, address tokenB) external pure returns (address token0, address token1);

    /// @notice Get the address of a pool for a given token pair.
    function poolFor(address tokenA, address tokenB, bool stable, address factory)
        external
        view
        returns (address pool);

    /// @notice Get output amounts for a given input along a route.
    function getAmountsOut(uint256 amountIn, Route[] calldata routes)
        external
        view
        returns (uint256[] memory amounts);

    /// @notice Swap exact tokens for tokens along a route.
    function swapExactTokensForTokens(
        uint256 amountIn,
        uint256 amountOutMin,
        Route[] calldata routes,
        address to,
        uint256 deadline
    ) external returns (uint256[] memory amounts);

    /// @notice Swap exact ETH for tokens along a route.
    function swapExactETHForTokens(
        uint256 amountOutMin,
        Route[] calldata routes,
        address to,
        uint256 deadline
    ) external payable returns (uint256[] memory amounts);

    /// @notice Swap exact tokens for ETH along a route.
    function swapExactTokensForETH(
        uint256 amountIn,
        uint256 amountOutMin,
        Route[] calldata routes,
        address to,
        uint256 deadline
    ) external returns (uint256[] memory amounts);

    /// @notice Add liquidity to a pool.
    function addLiquidity(
        address tokenA,
        address tokenB,
        bool stable,
        uint256 amountADesired,
        uint256 amountBDesired,
        uint256 amountAMin,
        uint256 amountBMin,
        address to,
        uint256 deadline
    ) external returns (uint256 amountA, uint256 amountB, uint256 liquidity);

    /// @notice Add liquidity with ETH.
    function addLiquidityETH(
        address token,
        bool stable,
        uint256 amountTokenDesired,
        uint256 amountTokenMin,
        uint256 amountETHMin,
        address to,
        uint256 deadline
    ) external payable returns (uint256 amountToken, uint256 amountETH, uint256 liquidity);

    /// @notice Remove liquidity from a pool.
    function removeLiquidity(
        address tokenA,
        address tokenB,
        bool stable,
        uint256 liquidity,
        uint256 amountAMin,
        uint256 amountBMin,
        address to,
        uint256 deadline
    ) external returns (uint256 amountA, uint256 amountB);

    /// @notice Remove liquidity with ETH.
    function removeLiquidityETH(
        address token,
        bool stable,
        uint256 liquidity,
        uint256 amountTokenMin,
        uint256 amountETHMin,
        address to,
        uint256 deadline
    ) external returns (uint256 amountToken, uint256 amountETH);

    /// @notice Returns the address of the WETH contract.
    function weth() external view returns (address);

    /// @notice Returns the default factory address.
    function defaultFactory() external view returns (address);
}
