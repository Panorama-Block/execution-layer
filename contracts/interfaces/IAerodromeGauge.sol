// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title IAerodromeGauge
 * @notice Interface for Aerodrome Finance Gauge contracts on Base.
 * @dev Gauges are used to stake LP tokens and earn AERO rewards.
 *      Gauge addresses are resolved via the Voter contract.
 */
interface IAerodromeGauge {
    /// @notice Deposit LP tokens into the gauge.
    /// @param amount Amount of LP tokens to deposit.
    function deposit(uint256 amount) external;

    /// @notice Deposit LP tokens on behalf of a recipient.
    /// @param amount Amount of LP tokens to deposit.
    /// @param recipient Address to credit the deposit to.
    function deposit(uint256 amount, address recipient) external;

    /// @notice Withdraw LP tokens from the gauge.
    /// @param amount Amount of LP tokens to withdraw.
    function withdraw(uint256 amount) external;

    /// @notice Claim all pending AERO rewards.
    /// @param account Address to claim rewards for.
    function getReward(address account) external;

    /// @notice Get the amount of pending AERO rewards for an account.
    /// @param account Address to check.
    /// @return Amount of pending rewards.
    function earned(address account) external view returns (uint256);

    /// @notice Get the staked LP token balance for an account.
    /// @param account Address to check.
    /// @return Staked LP token balance.
    function balanceOf(address account) external view returns (uint256);

    /// @notice Get the total staked LP tokens in the gauge.
    /// @return Total staked amount.
    function totalSupply() external view returns (uint256);

    /// @notice Get the address of the staking (LP) token.
    /// @return Address of the LP token.
    function stakingToken() external view returns (address);

    /// @notice Get the address of the reward token (AERO).
    /// @return Address of the reward token.
    function rewardToken() external view returns (address);
}

/**
 * @title IAerodromeVoter
 * @notice Interface for the Aerodrome Voter contract that maps pools to gauges.
 * @dev Voter address on Base mainnet: 0x16613524e02ad97eDfeF371bC883F2F5d6C480A5
 */
interface IAerodromeVoter {
    /// @notice Get the gauge address for a given pool.
    /// @param pool Address of the liquidity pool.
    /// @return Address of the gauge (address(0) if no gauge exists).
    function gauges(address pool) external view returns (address);

    /// @notice Check if a gauge is alive (active).
    /// @param gauge Address of the gauge.
    /// @return Whether the gauge is active.
    function isAlive(address gauge) external view returns (bool);
}
