// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title ITraderJoeMasterChef
/// @notice Interface for MasterChefJoeV3 on Avalanche C-Chain
/// @dev MasterChefJoeV3: 0x188bED1968b795d5c9022F6a0bb5931Ac4c18F00
///      Harvest pattern: deposit(pid, 0) triggers reward collection without moving LP tokens.
interface ITraderJoeMasterChef {
    struct UserInfo {
        uint256 amount;
        uint256 rewardDebt;
    }

    /// @notice Deposit LP tokens and receive pending JOE rewards.
    /// @dev Calling with amount=0 is the harvest pattern for MCV3.
    function deposit(uint256 pid, uint256 amount) external;

    /// @notice Withdraw LP tokens and receive pending JOE rewards.
    function withdraw(uint256 pid, uint256 amount) external;

    /// @notice Returns pending JOE and bonus token rewards for a user in a pool.
    function pendingTokens(uint256 pid, address user)
        external
        view
        returns (
            uint256 pendingJoe,
            address bonusTokenAddress,
            string memory bonusTokenSymbol,
            uint256 pendingBonusToken
        );

    /// @notice Returns the user's deposited amount and reward debt.
    function userInfo(uint256 pid, address user) external view returns (uint256 amount, uint256 rewardDebt);

    /// @notice Returns the JOE token address distributed as rewards.
    /// @dev MCV2 uses joe(), MCV3 exposes JOE() — call the correct one per version.
    function JOE() external view returns (address);
}
