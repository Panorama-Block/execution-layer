// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IStakedAvax} from "../interfaces/IStakedAvax.sol";

/// @title PanoramaLiquidStaking
/// @notice Liquid staking wrapper for BENQI sAVAX on Avalanche C-Chain.
///         Routes stake, unlock and redeem through this contract —
///         every operation burns AVAX as gas.
///
/// @dev sAVAX (StakedAvax): 0x2b2C81e08f1Af8835a78Bb2A90AE924ACE0eA4bE
///
///      Flow:
///        1. stake()         — send AVAX, receive sAVAX immediately
///        2. requestUnlock() — send sAVAX, start ~15-day cooldown
///        3. redeem()        — claim AVAX after cooldown expires
///
///      Multi-user safety:
///        unlock requests are tracked per user via _userUnlockIndices.
///        redeem(userIndex) uses the caller's own slot — no cross-user theft possible.
contract PanoramaLiquidStaking is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ─── Immutables ───────────────────────────────────────────────────────

    IStakedAvax public immutable sAvax;

    // ─── State ────────────────────────────────────────────────────────────

    /// @dev Maps user → list of sAVAX contract-level unlock request indices
    mapping(address => uint256[]) private _userUnlockIndices;

    // ─── Events ───────────────────────────────────────────────────────────

    event Staked(address indexed user, uint256 avaxAmount, uint256 sAvaxReceived);
    event UnlockRequested(address indexed user, uint256 sAvaxAmount, uint256 userUnlockIndex);
    event Redeemed(address indexed user, uint256 userUnlockIndex, uint256 avaxReceived);

    // ─── Errors ───────────────────────────────────────────────────────────

    error ZeroAmount();
    error InvalidUnlockIndex();
    error NativeTransferFailed();

    // ─── Constructor ──────────────────────────────────────────────────────

    /// @param _sAvax BENQI sAVAX contract address
    constructor(address _sAvax) Ownable(msg.sender) {
        sAvax = IStakedAvax(_sAvax);
    }

    // ─── Core Operations ──────────────────────────────────────────────────

    /// @notice Stake native AVAX and receive sAVAX
    /// @dev Burns AVAX as gas. Minted sAVAX is forwarded to caller.
    /// @return sAvaxReceived Amount of sAVAX minted
    function stake() external payable nonReentrant returns (uint256 sAvaxReceived) {
        if (msg.value == 0) revert ZeroAmount();

        sAvaxReceived = sAvax.submit{value: msg.value}();

        IERC20(address(sAvax)).safeTransfer(msg.sender, sAvaxReceived);

        emit Staked(msg.sender, msg.value, sAvaxReceived);
    }

    /// @notice Request unlock of sAVAX back to AVAX (starts ~15-day cooldown)
    /// @dev Burns AVAX as gas. Caller must approve this contract to spend sAVAX.
    /// @param sAvaxAmount Amount of sAVAX shares to unlock
    /// @return userUnlockIndex Index in the caller's personal unlock list (use for redeem)
    function requestUnlock(uint256 sAvaxAmount) external nonReentrant returns (uint256 userUnlockIndex) {
        if (sAvaxAmount == 0) revert ZeroAmount();

        IERC20(address(sAvax)).safeTransferFrom(msg.sender, address(this), sAvaxAmount);
        IERC20(address(sAvax)).forceApprove(address(sAvax), sAvaxAmount);

        // Record the contract-level index before the new request is pushed
        uint256 contractIndex = sAvax.getUnlockRequestCount(address(this));

        sAvax.requestUnlock(sAvaxAmount);

        // Store the mapping: caller's slot → contract-level sAVAX index
        userUnlockIndex = _userUnlockIndices[msg.sender].length;
        _userUnlockIndices[msg.sender].push(contractIndex);

        emit UnlockRequested(msg.sender, sAvaxAmount, userUnlockIndex);
    }

    /// @notice Redeem AVAX after cooldown has elapsed
    /// @dev Burns AVAX as gas. Sends redeemed AVAX directly to caller.
    /// @param userUnlockIndex Index in the caller's personal unlock list (returned by requestUnlock)
    function redeem(uint256 userUnlockIndex) external nonReentrant {
        uint256[] storage indices = _userUnlockIndices[msg.sender];
        if (userUnlockIndex >= indices.length) revert InvalidUnlockIndex();

        uint256 contractIndex = indices[userUnlockIndex];

        // Remove slot (swap with last to avoid gaps)
        indices[userUnlockIndex] = indices[indices.length - 1];
        indices.pop();

        uint256 balanceBefore = address(this).balance;

        sAvax.redeem(contractIndex);

        uint256 avaxReceived = address(this).balance - balanceBefore;

        (bool ok,) = msg.sender.call{value: avaxReceived}("");
        if (!ok) revert NativeTransferFailed();

        emit Redeemed(msg.sender, userUnlockIndex, avaxReceived);
    }

    // ─── View Helpers ─────────────────────────────────────────────────────

    /// @notice Preview how much sAVAX you receive for a given AVAX amount
    function previewStake(uint256 avaxAmount) external view returns (uint256) {
        return sAvax.getSharesByPooledAvax(avaxAmount);
    }

    /// @notice Preview how much AVAX you receive for a given sAVAX amount
    function previewRedeem(uint256 sAvaxAmount) external view returns (uint256) {
        return sAvax.getPooledAvaxByShares(sAvaxAmount);
    }

    /// @notice Current AVAX/sAVAX exchange rate (1 sAVAX = ? AVAX), scaled by 1e18
    function exchangeRate() external view returns (uint256) {
        uint256 totalShares = sAvax.totalShares();
        if (totalShares == 0) return 1e18;
        return (sAvax.totalPooledAvax() * 1e18) / totalShares;
    }

    /// @notice Number of pending unlock requests for a user
    function getUnlockRequestCount(address user) external view returns (uint256) {
        return _userUnlockIndices[user].length;
    }

    /// @notice Get an unlock request for a user by their personal index
    function getUnlockRequest(address user, uint256 userUnlockIndex)
        external view
        returns (IStakedAvax.UnlockRequest memory)
    {
        uint256[] storage indices = _userUnlockIndices[user];
        if (userUnlockIndex >= indices.length) revert InvalidUnlockIndex();
        return sAvax.getUnlockRequest(address(this), indices[userUnlockIndex]);
    }

    // ─── Fallback ─────────────────────────────────────────────────────────

    receive() external payable {}
}
