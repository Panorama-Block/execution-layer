// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title IMoonwellToken
/// @notice Interface for Moonwell mToken markets (ERC20 underlying — Compound v2 fork on Base).
/// @dev All mToken markets on Base use ERC20 underlyings.
///      There is NO native ETH market on Moonwell Base — ETH is handled via WETH wrapping
///      at the adapter level (supplyETH/redeemETH/borrowETH/repayETH).
///
///      Key addresses (Base mainnet):
///        Comptroller: 0xfBb21d0380beE3312B33c4353c8936a0F13EF26C
///        mUSDC:       0xEdc817A28E8B93B03976FBd4a3dDBc9f7D176c22
///        mWETH:       0x628ff693426583D9a7FB391E54366292F509D457
///        mcbETH:      0x3bf93770f2d4a794c3d9EBEfBAeBAE2a8f09A5E9
///        mDAI:        0x73b06D8d18De422E269645eaCe15400DE7462417
///        mUSDbC:      0x703843C3379b52F9FF486c9f5892218d2a065cC8
interface IMoonwellToken {
    /// @notice Supply ERC20 underlying to earn interest; mints mTokens to caller.
    /// @param mintAmount Amount of underlying to supply.
    /// @return 0 on success, non-zero error code otherwise.
    function mint(uint256 mintAmount) external returns (uint256);

    /// @notice Redeem mTokens for the underlying ERC20.
    /// @param redeemTokens Amount of mTokens to redeem.
    /// @return 0 on success, non-zero error code otherwise.
    function redeem(uint256 redeemTokens) external returns (uint256);

    /// @notice Borrow underlying ERC20 against supplied collateral.
    /// @param borrowAmount Amount of underlying to borrow.
    /// @return 0 on success, non-zero error code otherwise.
    function borrow(uint256 borrowAmount) external returns (uint256);

    /// @notice Repay borrowed ERC20.
    /// @param repayAmount Amount of underlying to repay.
    /// @return 0 on success, non-zero error code otherwise.
    function repayBorrow(uint256 repayAmount) external returns (uint256);

    /// @notice Returns the underlying ERC20 token address.
    function underlying() external view returns (address);

    /// @notice Returns the mToken balance of an account.
    function balanceOf(address owner) external view returns (uint256);

    /// @notice Returns stored (non-accruing) borrow balance for account.
    function borrowBalanceStored(address account) external view returns (uint256);

    /// @notice Returns stored exchange rate: underlying per mToken (scaled by 1e18).
    function exchangeRateStored() external view returns (uint256);

    /// @notice Supply interest rate per block.
    function supplyRatePerBlock() external view returns (uint256);

    /// @notice Borrow interest rate per block.
    function borrowRatePerBlock() external view returns (uint256);
}

/// @title IMoonwellComptroller
/// @notice Interface for Moonwell Comptroller on Base.
interface IMoonwellComptroller {
    /// @notice Enter markets to use mTokens as collateral.
    /// @param mTokens Array of mToken addresses to enter.
    /// @return Array of error codes (0 = success per market).
    function enterMarkets(address[] calldata mTokens) external returns (uint256[] memory);

    /// @notice Exit a market (stop using mToken as collateral).
    /// @param mToken The mToken address to exit.
    /// @return 0 on success, non-zero error code otherwise.
    function exitMarket(address mToken) external returns (uint256);

    /// @notice Returns account liquidity: (err, excess collateral, shortfall).
    function getAccountLiquidity(address account)
        external
        view
        returns (uint256 err, uint256 liquidity, uint256 shortfall);
}
