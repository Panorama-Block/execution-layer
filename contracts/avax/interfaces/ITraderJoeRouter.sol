// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title ITraderJoeRouter
/// @notice Interface for Trader Joe V1 Router on Avalanche C-Chain
/// @dev Router address: 0x60aE616a2155Ee3d9A68541Ba4544862310933d4
interface ITraderJoeRouter {
    /// @notice Swap exact ERC20 tokens for ERC20 tokens
    function swapExactTokensForTokens(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external returns (uint256[] memory amounts);

    /// @notice Swap exact AVAX for ERC20 tokens
    function swapExactAVAXForTokens(
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external payable returns (uint256[] memory amounts);

    /// @notice Swap exact ERC20 tokens for AVAX
    function swapExactTokensForAVAX(
        uint256 amountIn,
        uint256 amountOutMinAVAX,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external returns (uint256[] memory amounts);

    /// @notice Get output amounts for a given input and path
    function getAmountsOut(uint256 amountIn, address[] calldata path)
        external
        view
        returns (uint256[] memory amounts);

    /// @notice Returns the WAVAX address
    function WAVAX() external pure returns (address);
}
