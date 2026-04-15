// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Initializable} from "@openzeppelin/contracts/proxy/utils/Initializable.sol";
import {IStakedAvax} from "../interfaces/IStakedAvax.sol";
import {IStakeAdapter} from "../../interfaces/IStakeAdapter.sol";

/**
 * @title SAVAXAdapter
 * @notice Proxy-compatible adapter for BENQI sAVAX liquid staking on Avalanche.
 * @dev Replaces PanoramaLiquidStaking with per-user BeaconProxy isolation.
 *
 *      Key improvement over PanoramaLiquidStaking:
 *        - Each user's proxy has its own unlock request tracking
 *        - sAVAX held in proxy is per-user (no mixing)
 *        - Upgradeable via UpgradeableBeacon
 *
 *      sAVAX: 0x2b2C81e08f1Af8835a78Bb2A90AE924ACE0eA4bE
 *
 *      Storage layout:
 *        slot 0: sAvax (IStakedAvax)
 *        slot 1: executor (address)
 *        slot 2: _unlockIndices (dynamic array — contract-level unlock indices)
 *        slots 3-52: __gap (50 reserved)
 */
contract SAVAXAdapter is Initializable, IStakeAdapter {
    using SafeERC20 for IERC20;

    // ========== STORAGE ==========

    IStakedAvax public sAvax;
    address public executor;

    /// @dev Contract-level unlock request indices for this proxy's user.
    ///      Since each user gets their own proxy, we don't need per-user mapping.
    uint256[] private _unlockIndices;

    // ========== STORAGE GAP ==========

    uint256[50] private __gap;

    // ========== ERRORS ==========

    error OnlyExecutor();
    error ZeroAmount();
    error InvalidUnlockIndex();
    error NativeTransferFailed();

    // ========== MODIFIERS ==========

    modifier onlyExecutor() {
        if (msg.sender != executor) revert OnlyExecutor();
        _;
    }

    // ========== INITIALIZER ==========

    /**
     * @notice Initialize the adapter proxy.
     * @dev initArgs = abi.encode(sAvaxAddress).
     *
     * @param _executor  The PanoramaExecutorV2 contract address.
     * @param _initArgs  ABI-encoded: (address sAvax).
     */
    function initializeFull(address _executor, bytes calldata _initArgs) external initializer {
        executor = _executor;
        address _sAvax = abi.decode(_initArgs, (address));
        sAvax = IStakedAvax(_sAvax);
    }

    // ========== CORE OPERATIONS ==========

    /**
     * @notice Stake native AVAX and receive sAVAX.
     * @param recipient Address to receive sAVAX tokens.
     * @return sAvaxReceived Amount of sAVAX minted.
     */
    function stake(address recipient) external payable override onlyExecutor returns (uint256 sAvaxReceived) {
        if (msg.value == 0) revert ZeroAmount();

        sAvaxReceived = sAvax.submit{value: msg.value}();

        if (recipient != address(this)) {
            IERC20(address(sAvax)).safeTransfer(recipient, sAvaxReceived);
        }
    }

    /**
     * @notice Request unlock of sAVAX back to AVAX (starts ~15-day cooldown).
     * @dev sAVAX must already be in this proxy (transferred via executor).
     *
     * @param sAvaxAmount Amount of sAVAX shares to unlock.
     * @return unlockIndex Index in this proxy's unlock list (use for redeem).
     */
    function requestUnlock(uint256 sAvaxAmount) external override onlyExecutor returns (uint256 unlockIndex) {
        if (sAvaxAmount == 0) revert ZeroAmount();

        IERC20(address(sAvax)).forceApprove(address(sAvax), sAvaxAmount);

        // Record the contract-level index before the new request
        uint256 contractIndex = sAvax.getUnlockRequestCount(address(this));

        sAvax.requestUnlock(sAvaxAmount);

        // Store in our local tracking
        unlockIndex = _unlockIndices.length;
        _unlockIndices.push(contractIndex);
    }

    /**
     * @notice Redeem AVAX after cooldown has elapsed.
     * @param unlockIndex Index in this proxy's unlock list (returned by requestUnlock).
     * @param recipient   Address to receive redeemed AVAX.
     */
    function redeem(uint256 unlockIndex, address recipient) external override onlyExecutor {
        if (unlockIndex >= _unlockIndices.length) revert InvalidUnlockIndex();

        uint256 contractIndex = _unlockIndices[unlockIndex];

        // Swap with last to remove (avoids gaps)
        _unlockIndices[unlockIndex] = _unlockIndices[_unlockIndices.length - 1];
        _unlockIndices.pop();

        uint256 balBefore = address(this).balance;
        sAvax.redeem(contractIndex);
        uint256 avaxReceived = address(this).balance - balBefore;

        (bool ok,) = recipient.call{value: avaxReceived}("");
        if (!ok) revert NativeTransferFailed();
    }

    // ========== VIEW ==========

    /// @notice Preview how much sAVAX for a given AVAX amount.
    function previewStake(uint256 avaxAmount) external view returns (uint256) {
        return sAvax.getSharesByPooledAvax(avaxAmount);
    }

    /// @notice Preview how much AVAX for a given sAVAX amount.
    function previewRedeem(uint256 sAvaxAmount) external view returns (uint256) {
        return sAvax.getPooledAvaxByShares(sAvaxAmount);
    }

    /// @notice Current AVAX/sAVAX exchange rate, scaled by 1e18.
    function exchangeRate() external view returns (uint256) {
        uint256 totalShares = sAvax.totalShares();
        if (totalShares == 0) return 1e18;
        return (sAvax.totalPooledAvax() * 1e18) / totalShares;
    }

    /// @notice Number of pending unlock requests for this proxy.
    function getUnlockRequestCount() external view returns (uint256) {
        return _unlockIndices.length;
    }

    /// @notice Get an unlock request by index.
    function getUnlockRequest(uint256 unlockIndex) external view returns (IStakedAvax.UnlockRequest memory) {
        if (unlockIndex >= _unlockIndices.length) revert InvalidUnlockIndex();
        return sAvax.getUnlockRequest(address(this), _unlockIndices[unlockIndex]);
    }

    // ========== FALLBACK ==========

    receive() external payable {}
}
