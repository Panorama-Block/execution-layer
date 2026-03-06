// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IAerodromeRouter} from "../../contracts/interfaces/IAerodromeRouter.sol";
import {MockERC20} from "./MockERC20.sol";

/**
 * @title MockRouter
 * @notice Mock Aerodrome Router for testing. Simulates swaps at a fixed 1:1 rate.
 */
contract MockRouter {
    address public immutable weth;
    address public immutable defaultFactory;

    uint256 public mockOutputMultiplier = 1e18; // 1:1 by default

    constructor(address _weth, address _factory) {
        weth = _weth;
        defaultFactory = _factory;
    }

    function setMockOutputMultiplier(uint256 _multiplier) external {
        mockOutputMultiplier = _multiplier;
    }

    function sortTokens(address tokenA, address tokenB) external pure returns (address token0, address token1) {
        (token0, token1) = tokenA < tokenB ? (tokenA, tokenB) : (tokenB, tokenA);
    }

    function poolFor(address, address, bool, address) external view returns (address) {
        return address(this); // Return self as mock pool
    }

    function getAmountsOut(uint256 amountIn, IAerodromeRouter.Route[] calldata routes)
        external
        view
        returns (uint256[] memory amounts)
    {
        amounts = new uint256[](routes.length + 1);
        amounts[0] = amountIn;
        for (uint256 i = 0; i < routes.length; i++) {
            amounts[i + 1] = (amountIn * mockOutputMultiplier) / 1e18;
        }
    }

    function swapExactTokensForTokens(
        uint256 amountIn,
        uint256, /* amountOutMin */
        IAerodromeRouter.Route[] calldata routes,
        address to,
        uint256 /* deadline */
    ) external returns (uint256[] memory amounts) {
        amounts = new uint256[](routes.length + 1);
        amounts[0] = amountIn;

        // Pull input tokens
        address tokenIn = routes[0].from;
        MockERC20(tokenIn).transferFrom(msg.sender, address(this), amountIn);

        // Mint output tokens
        uint256 amountOut = (amountIn * mockOutputMultiplier) / 1e18;
        address tokenOut = routes[routes.length - 1].to;
        MockERC20(tokenOut).mint(to, amountOut);

        amounts[routes.length] = amountOut;
    }

    function swapExactETHForTokens(
        uint256, /* amountOutMin */
        IAerodromeRouter.Route[] calldata routes,
        address to,
        uint256 /* deadline */
    ) external payable returns (uint256[] memory amounts) {
        amounts = new uint256[](routes.length + 1);
        amounts[0] = msg.value;

        uint256 amountOut = (msg.value * mockOutputMultiplier) / 1e18;
        address tokenOut = routes[routes.length - 1].to;
        MockERC20(tokenOut).mint(to, amountOut);

        amounts[routes.length] = amountOut;
    }

    function swapExactTokensForETH(
        uint256 amountIn,
        uint256, /* amountOutMin */
        IAerodromeRouter.Route[] calldata routes,
        address to,
        uint256 /* deadline */
    ) external returns (uint256[] memory amounts) {
        amounts = new uint256[](routes.length + 1);
        amounts[0] = amountIn;

        address tokenIn = routes[0].from;
        MockERC20(tokenIn).transferFrom(msg.sender, address(this), amountIn);

        uint256 amountOut = (amountIn * mockOutputMultiplier) / 1e18;
        (bool success,) = to.call{value: amountOut}("");
        require(success, "ETH transfer failed");

        amounts[routes.length] = amountOut;
    }

    function addLiquidity(
        address tokenA,
        address tokenB,
        bool, /* stable */
        uint256 amountADesired,
        uint256 amountBDesired,
        uint256, /* amountAMin */
        uint256, /* amountBMin */
        address to,
        uint256 /* deadline */
    ) external returns (uint256 amountA, uint256 amountB, uint256 liquidity) {
        MockERC20(tokenA).transferFrom(msg.sender, address(this), amountADesired);
        MockERC20(tokenB).transferFrom(msg.sender, address(this), amountBDesired);
        liquidity = amountADesired; // Simplified
        amountA = amountADesired;
        amountB = amountBDesired;
        // Mint LP tokens (use tokenA as mock LP)
        MockERC20(tokenA).mint(to, liquidity);
    }

    function removeLiquidity(
        address tokenA,
        address tokenB,
        bool, /* stable */
        uint256 liquidity,
        uint256, /* amountAMin */
        uint256, /* amountBMin */
        address to,
        uint256 /* deadline */
    ) external returns (uint256 amountA, uint256 amountB) {
        amountA = liquidity / 2;
        amountB = liquidity / 2;
        MockERC20(tokenA).mint(to, amountA);
        MockERC20(tokenB).mint(to, amountB);
    }

    receive() external payable {}
}
