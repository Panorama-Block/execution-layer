// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title ILendAdapter
 * @notice Strict interface for Compound-fork lending adapters (Benqi, Moonwell, etc.).
 * @dev The Compound V2 money-market surface is stable across forks, so this interface
 *      enforces the shared ERC-20 action shape. Chain-native variants (supply native
 *      AVAX on Benqi, supply native ETH on Moonwell) live on the concrete adapter and
 *      are NOT declared here — their selectors differ per chain and would fragment the
 *      interface.
 *
 *      All methods here are `external` — the adapter implementations add
 *      `onlyExecutor` and any custom error handling (e.g. non-zero Compound error
 *      codes translated to revert).
 *
 *      Canonical selectors:
 *        - `supply(address,uint256,address)`
 *        - `redeem(address,uint256,address)`
 *        - `borrow(address,uint256,address)`
 *        - `repay(address,uint256)`
 *        - `enterMarkets(address[])`
 *        - `exitMarket(address)`
 */
interface ILendAdapter {
    /// @notice Supply ERC-20 to the lending market, receiving a Compound-style
    ///         receipt token (cToken / qToken / mToken).
    /// @param  market The market/cToken address.
    /// @param  amount Amount of the underlying ERC-20 to supply.
    /// @param  recipient Where the minted receipt tokens should end up.
    /// @return receiptMinted The amount of receipt tokens minted.
    function supply(
        address market,
        uint256 amount,
        address recipient
    ) external returns (uint256 receiptMinted);

    /// @notice Redeem receipt tokens back for the underlying ERC-20.
    /// @param  market The market/cToken address.
    /// @param  receiptAmount Amount of receipt tokens to redeem.
    /// @param  recipient Where the redeemed underlying should be sent.
    /// @return underlyingReceived The amount of underlying transferred to `recipient`.
    function redeem(
        address market,
        uint256 receiptAmount,
        address recipient
    ) external returns (uint256 underlyingReceived);

    /// @notice Borrow ERC-20 from the market against prior collateral in this adapter.
    /// @dev Implementations typically auto-enter the market to enable the borrow.
    /// @param market    Market to borrow from.
    /// @param amount    Amount of underlying to borrow.
    /// @param recipient Where the borrowed tokens should be forwarded.
    function borrow(
        address market,
        uint256 amount,
        address recipient
    ) external;

    /// @notice Repay an outstanding ERC-20 borrow.
    /// @param market The market where the debt exists.
    /// @param amount Amount of underlying to repay.
    function repay(
        address market,
        uint256 amount
    ) external;

    /// @notice Enable a set of markets as collateral for subsequent borrows.
    function enterMarkets(address[] calldata markets) external;

    /// @notice Disable a market as collateral.
    function exitMarket(address market) external;
}
