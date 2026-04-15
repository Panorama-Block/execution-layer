// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Initializable} from "@openzeppelin/contracts/proxy/utils/Initializable.sol";
import {IBenqiToken, IBenqiAVAX, IComptroller} from "../interfaces/IBenqiToken.sol";
import {ILendAdapter} from "../../interfaces/ILendAdapter.sol";

/**
 * @title BenqiLendAdapter
 * @notice Proxy-compatible adapter for Benqi Finance lending on Avalanche.
 * @dev Replaces PanoramaLend (standalone) with per-user BeaconProxy isolation.
 *
 *      Key improvement over PanoramaLend:
 *        - Each user gets their own proxy → own Benqi position (qToken balances,
 *          borrow positions, collateral). No shared-state problem.
 *        - Upgradeable via UpgradeableBeacon.
 *        - Only executor can call — non-custodial (backend prepares, user signs).
 *
 *      Benqi Comptroller: 0x486Af39519B4Dc9a7fCcd318217352830E8AD9b4
 *      qiAVAX:            0x5C0401e81Bc07Ca70fAD469b451682c0d747Ef1c
 *
 *      Storage layout:
 *        slot 0: comptroller (IComptroller)
 *        slot 1: qiAVAX (address)
 *        slot 2: executor (address)
 *        slots 3-52: __gap (50 reserved)
 */
contract BenqiLendAdapter is Initializable, ILendAdapter {
    using SafeERC20 for IERC20;

    // ========== STORAGE ==========

    IComptroller public comptroller;
    address public qiAVAX;
    address public executor;

    // ========== STORAGE GAP ==========

    uint256[50] private __gap;

    // ========== ERRORS ==========

    error OnlyExecutor();
    error ZeroAmount();
    error BenqiError(uint256 errorCode);
    error NativeTransferFailed();

    // ========== MODIFIERS ==========

    modifier onlyExecutor() {
        if (msg.sender != executor) revert OnlyExecutor();
        _;
    }

    // ========== INITIALIZER ==========

    /**
     * @notice Initialize the adapter proxy.
     * @dev initArgs = abi.encode(comptrollerAddress, qiAVAXAddress).
     *
     * @param _executor  The PanoramaExecutorV2 contract address.
     * @param _initArgs  ABI-encoded: (address comptroller, address qiAVAX).
     */
    function initializeFull(address _executor, bytes calldata _initArgs) external initializer {
        executor = _executor;
        (address _comptroller, address _qiAVAX) = abi.decode(_initArgs, (address, address));
        comptroller = IComptroller(_comptroller);
        qiAVAX = _qiAVAX;
    }

    // ========== ERC20 SUPPLY / REDEEM ==========

    /**
     * @notice Supply ERC20 token to Benqi to earn interest.
     * @dev The adapter holds the qTokens — per-user proxy means per-user position.
     *      qTokens stay in the proxy so they can be used as collateral for borrowing.
     *
     * @param qToken The Benqi qToken market address (e.g. qiUSDC).
     * @param amount Amount of underlying token to supply.
     * @param recipient Address to receive minted qTokens (typically the user).
     */
    function supply(
        address qToken,
        uint256 amount,
        address recipient
    ) external override onlyExecutor returns (uint256 qTokensMinted) {
        if (amount == 0) revert ZeroAmount();

        address underlying = IBenqiToken(qToken).underlying();
        IERC20(underlying).forceApprove(qToken, amount);

        uint256 balBefore = IERC20(qToken).balanceOf(address(this));
        uint256 err = IBenqiToken(qToken).mint(amount);
        if (err != 0) revert BenqiError(err);
        qTokensMinted = IERC20(qToken).balanceOf(address(this)) - balBefore;

        // Forward qTokens to recipient if they want to hold them directly
        if (recipient != address(this)) {
            IERC20(qToken).safeTransfer(recipient, qTokensMinted);
        }
    }

    /**
     * @notice Redeem qTokens for underlying ERC20.
     * @param qToken       The Benqi qToken market address.
     * @param qTokenAmount Amount of qTokens to redeem.
     * @param recipient    Address to receive underlying tokens.
     */
    function redeem(
        address qToken,
        uint256 qTokenAmount,
        address recipient
    ) external override onlyExecutor returns (uint256 underlyingReceived) {
        if (qTokenAmount == 0) revert ZeroAmount();

        address underlying = IBenqiToken(qToken).underlying();
        uint256 balBefore = IERC20(underlying).balanceOf(address(this));

        uint256 err = IBenqiToken(qToken).redeem(qTokenAmount);
        if (err != 0) revert BenqiError(err);

        underlyingReceived = IERC20(underlying).balanceOf(address(this)) - balBefore;
        IERC20(underlying).safeTransfer(recipient, underlyingReceived);
    }

    // ========== ERC20 BORROW / REPAY ==========

    /**
     * @notice Borrow ERC20 from Benqi against supplied collateral.
     * @dev Automatically enters the market if not already entered.
     *      The proxy's own qToken balance acts as collateral.
     *
     * @param qToken    The Benqi qToken market to borrow from.
     * @param amount    Amount of underlying to borrow.
     * @param recipient Address to receive borrowed tokens.
     */
    function borrow(
        address qToken,
        uint256 amount,
        address recipient
    ) external override onlyExecutor {
        if (amount == 0) revert ZeroAmount();

        address[] memory markets = new address[](1);
        markets[0] = qToken;
        comptroller.enterMarkets(markets);

        uint256 err = IBenqiToken(qToken).borrow(amount);
        if (err != 0) revert BenqiError(err);

        address underlying = IBenqiToken(qToken).underlying();
        IERC20(underlying).safeTransfer(recipient, amount);
    }

    /**
     * @notice Repay borrowed ERC20.
     * @param qToken The Benqi qToken market where debt exists.
     * @param amount Amount of underlying to repay.
     */
    function repay(
        address qToken,
        uint256 amount
    ) external override onlyExecutor {
        if (amount == 0) revert ZeroAmount();

        address underlying = IBenqiToken(qToken).underlying();
        IERC20(underlying).forceApprove(qToken, amount);

        uint256 err = IBenqiToken(qToken).repayBorrow(amount);
        if (err != 0) revert BenqiError(err);
    }

    // ========== NATIVE AVAX SUPPLY / REDEEM ==========

    /**
     * @notice Supply native AVAX to Benqi to earn interest.
     * @param recipient Address to receive minted qiAVAX tokens.
     */
    function supplyAVAX(address recipient) external payable onlyExecutor returns (uint256 qTokensMinted) {
        if (msg.value == 0) revert ZeroAmount();

        uint256 balBefore = IERC20(qiAVAX).balanceOf(address(this));
        IBenqiAVAX(qiAVAX).mint{value: msg.value}();
        qTokensMinted = IERC20(qiAVAX).balanceOf(address(this)) - balBefore;

        if (recipient != address(this)) {
            IERC20(qiAVAX).safeTransfer(recipient, qTokensMinted);
        }
    }

    /**
     * @notice Redeem qiAVAX for native AVAX.
     * @param qTokenAmount Amount of qiAVAX to redeem.
     * @param recipient    Address to receive AVAX.
     */
    function redeemAVAX(uint256 qTokenAmount, address recipient) external onlyExecutor {
        if (qTokenAmount == 0) revert ZeroAmount();

        uint256 err = IBenqiAVAX(qiAVAX).redeem(qTokenAmount);
        if (err != 0) revert BenqiError(err);

        uint256 balance = address(this).balance;
        (bool ok,) = recipient.call{value: balance}("");
        if (!ok) revert NativeTransferFailed();
    }

    /**
     * @notice Borrow native AVAX against supplied collateral.
     * @param amount    Amount of AVAX to borrow (in wei).
     * @param recipient Address to receive borrowed AVAX.
     */
    function borrowAVAX(uint256 amount, address recipient) external onlyExecutor {
        if (amount == 0) revert ZeroAmount();

        address[] memory markets = new address[](1);
        markets[0] = qiAVAX;
        comptroller.enterMarkets(markets);

        uint256 err = IBenqiAVAX(qiAVAX).borrow(amount);
        if (err != 0) revert BenqiError(err);

        (bool ok,) = recipient.call{value: amount}("");
        if (!ok) revert NativeTransferFailed();
    }

    /**
     * @notice Repay borrowed native AVAX.
     */
    function repayAVAX() external payable onlyExecutor {
        if (msg.value == 0) revert ZeroAmount();
        IBenqiAVAX(qiAVAX).repayBorrow{value: msg.value}();
    }

    // ========== COLLATERAL MANAGEMENT ==========

    /**
     * @notice Enter markets to enable qTokens as collateral.
     * @param qTokens Array of qToken addresses to enter.
     */
    function enterMarkets(address[] calldata qTokens) external override onlyExecutor {
        comptroller.enterMarkets(qTokens);
    }

    /**
     * @notice Exit a market (stop using as collateral).
     * @param qToken The qToken address to exit.
     */
    function exitMarket(address qToken) external override onlyExecutor {
        comptroller.exitMarket(qToken);
    }

    // ========== FALLBACK ==========

    receive() external payable {}
}
