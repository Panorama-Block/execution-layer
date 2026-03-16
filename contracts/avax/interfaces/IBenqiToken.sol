// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title IBenqiToken
/// @notice Interface for Benqi qToken markets (ERC20 underlying)
/// @dev Used for: qiUSDC, qiUSDT, qiETH, qiWBTC, etc.
interface IBenqiToken {
    /// @notice Supply underlying ERC20 to earn interest, mints qTokens to caller
    /// @param mintAmount Amount of underlying to supply
    /// @return 0 on success, error code otherwise
    function mint(uint256 mintAmount) external returns (uint256);

    /// @notice Redeem qTokens for underlying ERC20
    /// @param redeemTokens Amount of qTokens to redeem
    /// @return 0 on success, error code otherwise
    function redeem(uint256 redeemTokens) external returns (uint256);

    /// @notice Redeem a specific amount of underlying ERC20
    /// @param redeemAmount Amount of underlying to receive
    /// @return 0 on success, error code otherwise
    function redeemUnderlying(uint256 redeemAmount) external returns (uint256);

    /// @notice Borrow underlying ERC20 against supplied collateral
    /// @param borrowAmount Amount of underlying to borrow
    /// @return 0 on success, error code otherwise
    function borrow(uint256 borrowAmount) external returns (uint256);

    /// @notice Repay borrowed ERC20
    /// @param repayAmount Amount of underlying to repay
    /// @return 0 on success, error code otherwise
    function repayBorrow(uint256 repayAmount) external returns (uint256);

    /// @notice Returns the underlying ERC20 token address
    function underlying() external view returns (address);

    /// @notice Returns qToken balance of an account
    function balanceOf(address owner) external view returns (uint256);
}

/// @title IBenqiAVAX
/// @notice Interface for qiAVAX — the native AVAX lending market
/// @dev qiAVAX address: 0x5c0401e81bc07ca70fad469b451682c0d747ef1c
interface IBenqiAVAX {
    /// @notice Supply native AVAX to earn interest, mints qiAVAX to caller
    function mint() external payable;

    /// @notice Redeem qiAVAX for native AVAX
    /// @param redeemTokens Amount of qiAVAX to redeem
    /// @return 0 on success, error code otherwise
    function redeem(uint256 redeemTokens) external returns (uint256);

    /// @notice Borrow native AVAX against supplied collateral
    /// @param borrowAmount Amount of AVAX to borrow (in wei)
    /// @return 0 on success, error code otherwise
    function borrow(uint256 borrowAmount) external returns (uint256);

    /// @notice Repay borrowed native AVAX
    function repayBorrow() external payable;

    /// @notice Returns qiAVAX balance of an account
    function balanceOf(address owner) external view returns (uint256);
}

/// @title IComptroller
/// @notice Interface for Benqi Comptroller (risk/market manager)
/// @dev Comptroller address: 0x486Af39519B4Dc9a7fCcd318217352830E8AD9b4
interface IComptroller {
    /// @notice Enter markets to use them as collateral
    /// @param qiTokens Array of qToken addresses to enter
    /// @return Array of error codes (0 = success)
    function enterMarkets(address[] calldata qiTokens) external returns (uint256[] memory);

    /// @notice Exit a market (stop using as collateral)
    /// @param qiToken The qToken address to exit
    /// @return 0 on success, error code otherwise
    function exitMarket(address qiToken) external returns (uint256);

    /// @notice Get account liquidity (excess collateral, shortfall)
    function getAccountLiquidity(address account)
        external
        view
        returns (uint256 err, uint256 liquidity, uint256 shortfall);
}
