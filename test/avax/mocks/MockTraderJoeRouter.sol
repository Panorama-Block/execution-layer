// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {MockERC20} from "../../mocks/MockERC20.sol";

/// @notice Mock Trader Joe V1 Router for unit tests (1:1 swap / LP ratio)
contract MockTraderJoeRouter {
    address private immutable _wavax;
    address private _factory;

    // Tracks LP minted per pair (tokenA < tokenB canonical order)
    mapping(address => MockERC20) public pairToken;

    /// @dev Register a mock LP token for a pair so tests can inspect it.
    function registerPair(address tokenA, address tokenB, address lpToken) external {
        (address a, address b) = tokenA < tokenB ? (tokenA, tokenB) : (tokenB, tokenA);
        pairToken[_pairKey(a, b)] = MockERC20(lpToken);
    }

    function setFactory(address f) external { _factory = f; }
    function factory() external view returns (address) { return _factory; }

    constructor(address wavax) {
        _wavax = wavax;
    }

    function WAVAX() external view returns (address) {
        return _wavax;
    }

    function swapExactTokensForTokens(
        uint256 amountIn,
        uint256, /*amountOutMin*/
        address[] calldata path,
        address to,
        uint256 /*deadline*/
    ) external returns (uint256[] memory amounts) {
        MockERC20(path[0]).transferFrom(msg.sender, address(this), amountIn);
        MockERC20(path[path.length - 1]).transfer(to, amountIn);

        amounts = new uint256[](path.length);
        amounts[0] = amountIn;
        amounts[path.length - 1] = amountIn;
    }

    function swapExactAVAXForTokens(
        uint256, /*amountOutMin*/
        address[] calldata path,
        address to,
        uint256 /*deadline*/
    ) external payable returns (uint256[] memory amounts) {
        MockERC20(path[path.length - 1]).transfer(to, msg.value);

        amounts = new uint256[](path.length);
        amounts[0] = msg.value;
        amounts[path.length - 1] = msg.value;
    }

    function swapExactTokensForAVAX(
        uint256 amountIn,
        uint256, /*amountOutMin*/
        address[] calldata path,
        address to,
        uint256 /*deadline*/
    ) external returns (uint256[] memory amounts) {
        MockERC20(path[0]).transferFrom(msg.sender, address(this), amountIn);
        payable(to).transfer(amountIn);

        amounts = new uint256[](path.length);
        amounts[0] = amountIn;
        amounts[path.length - 1] = amountIn;
    }

    function getAmountsOut(uint256 amountIn, address[] calldata path)
        external
        pure
        returns (uint256[] memory amounts)
    {
        amounts = new uint256[](path.length);
        for (uint256 i = 0; i < path.length; i++) {
            amounts[i] = amountIn;
        }
    }

    // ── LP ────────────────────────────────────────────────────────────────────

    /// @notice 1:1 mock: pulls desired amounts, mints LP tokens to `to`.
    function addLiquidity(
        address tokenA,
        address tokenB,
        uint256 amountADesired,
        uint256 amountBDesired,
        uint256, /*amountAMin*/
        uint256, /*amountBMin*/
        address to,
        uint256 /*deadline*/
    ) external returns (uint256 amountA, uint256 amountB, uint256 liquidity) {
        MockERC20(tokenA).transferFrom(msg.sender, address(this), amountADesired);
        MockERC20(tokenB).transferFrom(msg.sender, address(this), amountBDesired);

        MockERC20 lp = _getLp(tokenA, tokenB);
        lp.mint(to, amountADesired); // 1:1 LP ratio for simplicity

        return (amountADesired, amountBDesired, amountADesired);
    }

    function addLiquidityAVAX(
        address token,
        uint256 amountTokenDesired,
        uint256, /*amountTokenMin*/
        uint256, /*amountAVAXMin*/
        address to,
        uint256 /*deadline*/
    ) external payable returns (uint256 amountToken, uint256 amountAVAX, uint256 liquidity) {
        MockERC20(token).transferFrom(msg.sender, address(this), amountTokenDesired);

        MockERC20 lp = _getLp(token, _wavax);
        lp.mint(to, amountTokenDesired);

        return (amountTokenDesired, msg.value, amountTokenDesired);
    }

    /// @notice Burns LP tokens and returns underlying 1:1.
    function removeLiquidity(
        address tokenA,
        address tokenB,
        uint256 liquidityAmount,
        uint256, /*amountAMin*/
        uint256, /*amountBMin*/
        address to,
        uint256 /*deadline*/
    ) external returns (uint256 amountA, uint256 amountB) {
        MockERC20 lp = _getLp(tokenA, tokenB);
        lp.transferFrom(msg.sender, address(this), liquidityAmount);
        lp.burn(address(this), liquidityAmount);

        MockERC20(tokenA).transfer(to, liquidityAmount);
        MockERC20(tokenB).transfer(to, liquidityAmount);
        return (liquidityAmount, liquidityAmount);
    }

    function removeLiquidityAVAX(
        address token,
        uint256 liquidityAmount,
        uint256, /*amountTokenMin*/
        uint256, /*amountAVAXMin*/
        address to,
        uint256 /*deadline*/
    ) external returns (uint256 amountToken, uint256 amountAVAX) {
        MockERC20 lp = _getLp(token, _wavax);
        lp.transferFrom(msg.sender, address(this), liquidityAmount);
        lp.burn(address(this), liquidityAmount);

        MockERC20(token).transfer(to, liquidityAmount);
        payable(to).transfer(liquidityAmount);
        return (liquidityAmount, liquidityAmount);
    }

    // ── Internal ──────────────────────────────────────────────────────────────

    function _pairKey(address a, address b) internal pure returns (address) {
        return address(uint160(uint256(keccak256(abi.encodePacked(a, b)))));
    }

    function _getLp(address tokenA, address tokenB) internal view returns (MockERC20) {
        (address a, address b) = tokenA < tokenB ? (tokenA, tokenB) : (tokenB, tokenA);
        MockERC20 lp = pairToken[_pairKey(a, b)];
        require(address(lp) != address(0), "MockRouter: pair not registered");
        return lp;
    }

    receive() external payable {}
}
