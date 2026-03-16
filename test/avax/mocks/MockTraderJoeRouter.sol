// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {MockERC20} from "../../mocks/MockERC20.sol";

/// @notice Mock Trader Joe V1 Router for unit tests (1:1 swap ratio)
contract MockTraderJoeRouter {
    address private immutable _wavax;

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

    receive() external payable {}
}
