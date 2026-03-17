// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title IStakedAvax
/// @notice Interface for BENQI Liquid Staking (sAVAX) on Avalanche C-Chain
/// @dev sAVAX contract: 0x2b2C81e08f1Af8835a78Bb2A90AE924ACE0eA4bE
interface IStakedAvax {
    struct UnlockRequest {
        uint256 shareAmount;
        uint256 unlockTime;
    }

    /// @notice Stake native AVAX and receive sAVAX shares
    /// @return shareAmount Amount of sAVAX minted to caller
    function submit() external payable returns (uint256 shareAmount);

    /// @notice Request to unlock sAVAX back to AVAX (starts cooldown ~15 days)
    /// @param shareAmount Amount of sAVAX shares to unlock
    function requestUnlock(uint256 shareAmount) external;

    /// @notice Redeem AVAX after cooldown period has elapsed
    /// @param unlockRequestIndex Index in the user's unlock request array
    function redeem(uint256 unlockRequestIndex) external;

    /// @notice Convert AVAX amount to sAVAX shares (preview)
    function getSharesByPooledAvax(uint256 avaxAmount) external view returns (uint256);

    /// @notice Convert sAVAX shares to AVAX amount (preview)
    function getPooledAvaxByShares(uint256 shareAmount) external view returns (uint256);

    /// @notice Total AVAX pooled in the protocol
    function totalPooledAvax() external view returns (uint256);

    /// @notice Total sAVAX shares in existence
    function totalShares() external view returns (uint256);

    /// @notice Get a specific unlock request for a user
    function getUnlockRequest(address user, uint256 index) external view returns (UnlockRequest memory);

    /// @notice Get the number of unlock requests for a user
    function getUnlockRequestCount(address user) external view returns (uint256);
}
