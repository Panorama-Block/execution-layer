// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title IStakeAdapter
 * @notice Strict interface for liquid-staking adapters whose unstake flow has a
 *         cooldown window (Benqi sAVAX, Lido stETH queue, etc.).
 * @dev The three core actions — stake, request unlock, redeem after cooldown — are
 *      consistent across this class of protocols. Protocols with instantaneous
 *      unstake (e.g. synchronous liquid staking derivatives) can still implement
 *      `requestUnlock` + `redeem` as a single-step no-op if needed, but in practice
 *      those should get their own interface (e.g. `IInstantStakeAdapter`) rather than
 *      pretend to cooldown.
 *
 *      Canonical selectors:
 *        - `stake(address)`
 *        - `requestUnlock(uint256)`
 *        - `redeem(uint256,address)`
 */
interface IStakeAdapter {
    /// @notice Stake native chain asset and receive the liquid-staking receipt token.
    /// @param recipient Where the minted receipt tokens should end up.
    /// @return sharesReceived The amount of receipt tokens minted.
    function stake(address recipient) external payable returns (uint256 sharesReceived);

    /// @notice Queue an unlock request for previously-staked shares.
    /// @dev Starts the protocol's cooldown period. Shares must already live in the
    ///      adapter proxy — the executor transfers them in via a `Transfer`.
    /// @param  sharesAmount Amount of receipt tokens to queue for unlock.
    /// @return unlockIndex Local index used to identify this unlock when redeeming.
    function requestUnlock(uint256 sharesAmount) external returns (uint256 unlockIndex);

    /// @notice Redeem unlocked native asset after the cooldown has elapsed.
    /// @param unlockIndex Local index returned by `requestUnlock`.
    /// @param recipient   Where the redeemed native asset should be sent.
    function redeem(uint256 unlockIndex, address recipient) external;
}
