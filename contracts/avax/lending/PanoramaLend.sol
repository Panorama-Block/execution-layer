// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IBenqiToken, IBenqiAVAX, IComptroller} from "../interfaces/IBenqiToken.sol";

/// @title PanoramaLend
/// @notice Lending wrapper for Benqi Finance on Avalanche C-Chain.
///         Routes supply, redeem, borrow and repay operations through
///         this contract — every action burns AVAX as gas.
///
/// @dev Benqi Comptroller: 0x486Af39519B4Dc9a7fCcd318217352830E8AD9b4
///      qiAVAX:            0x5C0401e81Bc07Ca70fAD469b451682c0d747Ef1c
///      qiUSDC:            0xBEb5d47A3f720Ec0a390d04b4d41ED7d9688bC7F
///      qiUSDT:            0xc9e5999b8e75C3fEB117F6f73E664b9f3C8ca65C
///      qiETH:             0x334AD834Cd4481BB02d09615E7c11a00579A7909
///
/// @notice Borrow/repay operate on this contract's shared Benqi position.
///         Users must supply collateral via this contract before borrowing.
contract PanoramaLend is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ─── Immutables ───────────────────────────────────────────────────────

    IComptroller public immutable comptroller;
    address public immutable qiAVAX;

    // ─── Events ───────────────────────────────────────────────────────────

    event Supplied(address indexed user, address indexed qToken, uint256 amount);
    event Redeemed(address indexed user, address indexed qToken, uint256 qTokenAmount);
    event Borrowed(address indexed user, address indexed qToken, uint256 amount);
    event Repaid(address indexed user, address indexed qToken, uint256 amount);

    // ─── Errors ───────────────────────────────────────────────────────────

    error ZeroAmount();
    error BenqiError(uint256 errorCode);
    error NativeTransferFailed();

    // ─── Constructor ──────────────────────────────────────────────────────

    /// @param _comptroller Benqi Comptroller address
    /// @param _qiAVAX qiAVAX token address (native AVAX market)
    constructor(address _comptroller, address _qiAVAX) Ownable(msg.sender) {
        comptroller = IComptroller(_comptroller);
        qiAVAX = _qiAVAX;
    }

    // ─── ERC20 Operations ─────────────────────────────────────────────────

    /// @notice Supply ERC20 token to Benqi to earn interest
    /// @dev Transfers underlying from caller, mints qTokens back to caller
    /// @param qToken The Benqi qToken market address (e.g. qiUSDC)
    /// @param amount Amount of underlying token to supply
    function supply(address qToken, uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();

        address underlying = IBenqiToken(qToken).underlying();

        IERC20(underlying).safeTransferFrom(msg.sender, address(this), amount);
        IERC20(underlying).forceApprove(qToken, amount);

        uint256 err = IBenqiToken(qToken).mint(amount);
        if (err != 0) revert BenqiError(err);

        // Forward minted qTokens to user
        uint256 qTokenBalance = IERC20(qToken).balanceOf(address(this));
        IERC20(qToken).safeTransfer(msg.sender, qTokenBalance);

        emit Supplied(msg.sender, qToken, amount);
    }

    /// @notice Redeem qTokens for underlying ERC20
    /// @dev Caller sends qTokens in, receives underlying token back
    /// @param qToken The Benqi qToken market address
    /// @param qTokenAmount Amount of qTokens to redeem
    function redeem(address qToken, uint256 qTokenAmount) external nonReentrant {
        if (qTokenAmount == 0) revert ZeroAmount();

        IERC20(qToken).safeTransferFrom(msg.sender, address(this), qTokenAmount);

        uint256 err = IBenqiToken(qToken).redeem(qTokenAmount);
        if (err != 0) revert BenqiError(err);

        address underlying = IBenqiToken(qToken).underlying();
        uint256 balance = IERC20(underlying).balanceOf(address(this));
        IERC20(underlying).safeTransfer(msg.sender, balance);

        emit Redeemed(msg.sender, qToken, qTokenAmount);
    }

    /// @notice Borrow ERC20 from Benqi against supplied collateral
    /// @dev Collateral must have been supplied through this contract first.
    ///      Calls enterMarkets automatically on the target qToken.
    /// @param qToken The Benqi qToken market to borrow from
    /// @param amount Amount of underlying to borrow
    function borrow(address qToken, uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();

        address[] memory markets = new address[](1);
        markets[0] = qToken;
        comptroller.enterMarkets(markets);

        uint256 err = IBenqiToken(qToken).borrow(amount);
        if (err != 0) revert BenqiError(err);

        address underlying = IBenqiToken(qToken).underlying();
        IERC20(underlying).safeTransfer(msg.sender, amount);

        emit Borrowed(msg.sender, qToken, amount);
    }

    /// @notice Repay borrowed ERC20
    /// @param qToken The Benqi qToken market where debt exists
    /// @param amount Amount of underlying to repay
    function repay(address qToken, uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();

        address underlying = IBenqiToken(qToken).underlying();

        IERC20(underlying).safeTransferFrom(msg.sender, address(this), amount);
        IERC20(underlying).forceApprove(qToken, amount);

        uint256 err = IBenqiToken(qToken).repayBorrow(amount);
        if (err != 0) revert BenqiError(err);

        emit Repaid(msg.sender, qToken, amount);
    }

    // ─── Native AVAX Operations ───────────────────────────────────────────

    /// @notice Supply native AVAX to Benqi to earn interest
    /// @dev Mints qiAVAX and forwards them to the caller
    function supplyAVAX() external payable nonReentrant {
        if (msg.value == 0) revert ZeroAmount();

        IBenqiAVAX(qiAVAX).mint{value: msg.value}();

        uint256 qTokenBalance = IERC20(qiAVAX).balanceOf(address(this));
        IERC20(qiAVAX).safeTransfer(msg.sender, qTokenBalance);

        emit Supplied(msg.sender, qiAVAX, msg.value);
    }

    /// @notice Redeem qiAVAX for native AVAX
    /// @param qTokenAmount Amount of qiAVAX to redeem
    function redeemAVAX(uint256 qTokenAmount) external nonReentrant {
        if (qTokenAmount == 0) revert ZeroAmount();

        IERC20(qiAVAX).safeTransferFrom(msg.sender, address(this), qTokenAmount);

        uint256 err = IBenqiAVAX(qiAVAX).redeem(qTokenAmount);
        if (err != 0) revert BenqiError(err);

        uint256 balance = address(this).balance;
        (bool ok,) = msg.sender.call{value: balance}("");
        if (!ok) revert NativeTransferFailed();

        emit Redeemed(msg.sender, qiAVAX, qTokenAmount);
    }

    /// @notice Borrow native AVAX from Benqi against supplied collateral
    /// @dev Collateral must have been supplied through this contract first.
    /// @param amount Amount of AVAX to borrow (in wei)
    function borrowAVAX(uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();

        address[] memory markets = new address[](1);
        markets[0] = qiAVAX;
        comptroller.enterMarkets(markets);

        uint256 err = IBenqiAVAX(qiAVAX).borrow(amount);
        if (err != 0) revert BenqiError(err);

        (bool ok,) = msg.sender.call{value: amount}("");
        if (!ok) revert NativeTransferFailed();

        emit Borrowed(msg.sender, qiAVAX, amount);
    }

    /// @notice Repay borrowed native AVAX
    function repayAVAX() external payable nonReentrant {
        if (msg.value == 0) revert ZeroAmount();

        IBenqiAVAX(qiAVAX).repayBorrow{value: msg.value}();

        emit Repaid(msg.sender, qiAVAX, msg.value);
    }

    // ─── Fallback ─────────────────────────────────────────────────────────

    receive() external payable {}
}
