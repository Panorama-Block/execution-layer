// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Initializable} from "@openzeppelin/contracts/proxy/utils/Initializable.sol";
import {IMoonwellToken, IMoonwellComptroller} from "../interfaces/IMoonwellToken.sol";

/**
 * @title MoonwellLendAdapter
 * @notice Proxy-compatible adapter for Moonwell Finance lending on Base.
 * @dev Mirrors BenqiLendAdapter pattern on Avalanche, adapted for Moonwell (Compound v2 fork).
 *
 *      Key difference from Benqi:
 *        - Moonwell Base has NO native ETH market (no CEther equivalent).
 *        - All markets use ERC20 underlying tokens.
 *        - ETH variants (supplyETH/redeemETH/borrowETH/repayETH) wrap/unwrap WETH internally.
 *
 *      Key addresses (Base mainnet):
 *        Comptroller: 0xfBb21d0380beE3312B33c4353c8936a0F13EF26C
 *        WETH:        0x4200000000000000000000000000000000000006
 *        mWETH:       0x628ff693426583D9a7FB391E54366292F509D457
 *
 *      Storage layout:
 *        slot 0: comptroller (IMoonwellComptroller)
 *        slot 1: weth (address)
 *        slot 2: executor (address)
 *        slots 3-52: __gap (50 reserved)
 *
 * TODO: add `is ILendAdapter` once Hugo delivers contracts/interfaces/ILendAdapter.sol
 */
contract MoonwellLendAdapter is Initializable {
    using SafeERC20 for IERC20;

    // ========== STORAGE ==========

    IMoonwellComptroller public comptroller;
    address public weth;
    address public executor;

    // ========== STORAGE GAP ==========

    uint256[50] private __gap;

    // ========== ERRORS ==========

    error OnlyExecutor();
    error ZeroAmount();
    error MoonwellError(uint256 errorCode);
    error NativeTransferFailed();

    // ========== MODIFIERS ==========

    modifier onlyExecutor() {
        if (msg.sender != executor) revert OnlyExecutor();
        _;
    }

    // ========== INITIALIZER ==========

    /**
     * @notice Initialise the adapter proxy.
     * @dev initArgs = abi.encode(comptrollerAddress, wethAddress).
     *
     * @param _executor  The PanoramaExecutorV2 contract address.
     * @param _initArgs  ABI-encoded: (address comptroller, address weth).
     */
    function initializeFull(address _executor, bytes calldata _initArgs) external initializer {
        executor = _executor;
        (address _comptroller, address _weth) = abi.decode(_initArgs, (address, address));
        comptroller = IMoonwellComptroller(_comptroller);
        weth = _weth;
    }

    // ========== ERC20 SUPPLY / REDEEM ==========

    /**
     * @notice Supply ERC20 token to Moonwell to earn interest.
     * @param mToken    The Moonwell mToken market address (e.g. mUSDC).
     * @param amount    Amount of underlying to supply.
     * @param recipient Address to receive minted mTokens.
     */
    function supply(
        address mToken,
        uint256 amount,
        address recipient
    ) external onlyExecutor returns (uint256 mTokensMinted) {
        if (amount == 0) revert ZeroAmount();

        address underlying = IMoonwellToken(mToken).underlying();
        IERC20(underlying).forceApprove(mToken, amount);

        uint256 balBefore = IERC20(mToken).balanceOf(address(this));
        uint256 err = IMoonwellToken(mToken).mint(amount);
        if (err != 0) revert MoonwellError(err);
        mTokensMinted = IERC20(mToken).balanceOf(address(this)) - balBefore;

        if (recipient != address(this)) {
            IERC20(mToken).safeTransfer(recipient, mTokensMinted);
        }
    }

    /**
     * @notice Redeem mTokens for underlying ERC20.
     * @param mToken       The Moonwell mToken market address.
     * @param mTokenAmount Amount of mTokens to redeem.
     * @param recipient    Address to receive underlying tokens.
     */
    function redeem(
        address mToken,
        uint256 mTokenAmount,
        address recipient
    ) external onlyExecutor returns (uint256 underlyingReceived) {
        if (mTokenAmount == 0) revert ZeroAmount();

        address underlying = IMoonwellToken(mToken).underlying();
        uint256 balBefore = IERC20(underlying).balanceOf(address(this));

        uint256 err = IMoonwellToken(mToken).redeem(mTokenAmount);
        if (err != 0) revert MoonwellError(err);

        underlyingReceived = IERC20(underlying).balanceOf(address(this)) - balBefore;
        IERC20(underlying).safeTransfer(recipient, underlyingReceived);
    }

    // ========== ERC20 BORROW / REPAY ==========

    /**
     * @notice Borrow ERC20 from Moonwell against supplied collateral.
     * @param mToken    The Moonwell mToken market to borrow from.
     * @param amount    Amount of underlying to borrow.
     * @param recipient Address to receive borrowed tokens.
     */
    function borrow(
        address mToken,
        uint256 amount,
        address recipient
    ) external onlyExecutor {
        if (amount == 0) revert ZeroAmount();

        address[] memory markets = new address[](1);
        markets[0] = mToken;
        comptroller.enterMarkets(markets);

        uint256 err = IMoonwellToken(mToken).borrow(amount);
        if (err != 0) revert MoonwellError(err);

        address underlying = IMoonwellToken(mToken).underlying();
        IERC20(underlying).safeTransfer(recipient, amount);
    }

    /**
     * @notice Repay borrowed ERC20.
     * @param mToken The Moonwell mToken market where debt exists.
     * @param amount Amount of underlying to repay.
     */
    function repay(
        address mToken,
        uint256 amount
    ) external onlyExecutor {
        if (amount == 0) revert ZeroAmount();

        address underlying = IMoonwellToken(mToken).underlying();
        IERC20(underlying).forceApprove(mToken, amount);

        uint256 err = IMoonwellToken(mToken).repayBorrow(amount);
        if (err != 0) revert MoonwellError(err);
    }

    // ========== ETH VARIANTS (wrap/unwrap WETH internally) ==========

    /**
     * @notice Supply native ETH to Moonwell mWETH market.
     * @dev Wraps ETH → WETH internally, then supplies to mWETH.
     * @param mWETH     The Moonwell mWETH market address.
     * @param recipient Address to receive minted mWETH tokens.
     */
    function supplyETH(
        address mWETH,
        address recipient
    ) external payable onlyExecutor returns (uint256 mTokensMinted) {
        if (msg.value == 0) revert ZeroAmount();

        // Wrap ETH → WETH
        (bool ok,) = weth.call{value: msg.value}(abi.encodeWithSignature("deposit()"));
        if (!ok) revert NativeTransferFailed();

        // Supply WETH to mWETH market
        IERC20(weth).forceApprove(mWETH, msg.value);

        uint256 balBefore = IERC20(mWETH).balanceOf(address(this));
        uint256 err = IMoonwellToken(mWETH).mint(msg.value);
        if (err != 0) revert MoonwellError(err);
        mTokensMinted = IERC20(mWETH).balanceOf(address(this)) - balBefore;

        if (recipient != address(this)) {
            IERC20(mWETH).safeTransfer(recipient, mTokensMinted);
        }
    }

    /**
     * @notice Redeem mWETH tokens and unwrap to native ETH.
     * @param mWETH        The Moonwell mWETH market address.
     * @param mTokenAmount Amount of mWETH tokens to redeem.
     * @param recipient    Address to receive native ETH.
     */
    function redeemETH(
        address mWETH,
        uint256 mTokenAmount,
        address recipient
    ) external onlyExecutor {
        if (mTokenAmount == 0) revert ZeroAmount();

        uint256 wethBefore = IERC20(weth).balanceOf(address(this));
        uint256 err = IMoonwellToken(mWETH).redeem(mTokenAmount);
        if (err != 0) revert MoonwellError(err);

        uint256 wethReceived = IERC20(weth).balanceOf(address(this)) - wethBefore;

        // Unwrap WETH → ETH
        (bool ok,) = weth.call(abi.encodeWithSignature("withdraw(uint256)", wethReceived));
        if (!ok) revert NativeTransferFailed();

        (bool sent,) = recipient.call{value: wethReceived}("");
        if (!sent) revert NativeTransferFailed();
    }

    /**
     * @notice Borrow WETH from Moonwell mWETH and unwrap to native ETH.
     * @param mWETH     The Moonwell mWETH market address.
     * @param amount    Amount of WETH to borrow (in wei).
     * @param recipient Address to receive native ETH.
     */
    function borrowETH(
        address mWETH,
        uint256 amount,
        address recipient
    ) external onlyExecutor {
        if (amount == 0) revert ZeroAmount();

        address[] memory markets = new address[](1);
        markets[0] = mWETH;
        comptroller.enterMarkets(markets);

        uint256 err = IMoonwellToken(mWETH).borrow(amount);
        if (err != 0) revert MoonwellError(err);

        // Unwrap WETH → ETH
        (bool ok,) = weth.call(abi.encodeWithSignature("withdraw(uint256)", amount));
        if (!ok) revert NativeTransferFailed();

        (bool sent,) = recipient.call{value: amount}("");
        if (!sent) revert NativeTransferFailed();
    }

    /**
     * @notice Repay borrowed WETH using native ETH (wraps internally).
     * @param mWETH The Moonwell mWETH market address.
     */
    function repayETH(address mWETH) external payable onlyExecutor {
        if (msg.value == 0) revert ZeroAmount();

        // Wrap ETH → WETH
        (bool ok,) = weth.call{value: msg.value}(abi.encodeWithSignature("deposit()"));
        if (!ok) revert NativeTransferFailed();

        IERC20(weth).forceApprove(mWETH, msg.value);
        uint256 err = IMoonwellToken(mWETH).repayBorrow(msg.value);
        if (err != 0) revert MoonwellError(err);
    }

    // ========== COLLATERAL MANAGEMENT ==========

    /**
     * @notice Enter markets to enable mTokens as collateral.
     * @param mTokens Array of mToken addresses to enter.
     */
    function enterMarkets(address[] calldata mTokens) external onlyExecutor {
        comptroller.enterMarkets(mTokens);
    }

    /**
     * @notice Exit a market (stop using as collateral).
     * @param mToken The mToken address to exit.
     */
    function exitMarket(address mToken) external onlyExecutor {
        comptroller.exitMarket(mToken);
    }

    // ========== FALLBACK ==========

    receive() external payable {}
}
