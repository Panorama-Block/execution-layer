// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {MockERC20} from "../../mocks/MockERC20.sol";
import {ITraderJoeMasterChef} from "../../../contracts/avax/interfaces/ITraderJoeMasterChef.sol";

/// @notice Mock MasterChefJoeV3 for unit tests.
///         Tracks deposits/withdrawals and mints JOE rewards on harvest.
contract MockMasterChef is ITraderJoeMasterChef {
    MockERC20 public immutable joeRewardToken;

    // pid → user → deposited amount
    mapping(uint256 => mapping(address => uint256)) private _deposited;

    // JOE rewards minted per harvest call (flat for tests)
    uint256 public rewardPerHarvest = 100e18;

    constructor(address _joe) {
        joeRewardToken = MockERC20(_joe);
    }

    function JOE() external view returns (address) {
        return address(joeRewardToken);
    }

    function deposit(uint256 pid, uint256 amount) external override {
        if (amount > 0) {
            _deposited[pid][msg.sender] += amount;
        }
        // Mint JOE rewards to simulate harvest on every deposit (including amount=0)
        joeRewardToken.mint(msg.sender, rewardPerHarvest);
    }

    function withdraw(uint256 pid, uint256 amount) external override {
        require(_deposited[pid][msg.sender] >= amount, "MockMasterChef: insufficient deposit");
        _deposited[pid][msg.sender] -= amount;
        // Return LP tokens — test must pre-fund or use a real ERC20
        // Just mint JOE rewards
        joeRewardToken.mint(msg.sender, rewardPerHarvest);
    }

    function pendingTokens(uint256, address)
        external
        view
        override
        returns (uint256, address, string memory, uint256)
    {
        return (rewardPerHarvest, address(0), "", 0);
    }

    function userInfo(uint256 pid, address user) external view override returns (uint256 amount, uint256 rewardDebt) {
        return (_deposited[pid][user], 0);
    }

    /// @dev Allows tests to set how many JOE are minted per harvest.
    function setRewardPerHarvest(uint256 amount) external {
        rewardPerHarvest = amount;
    }
}
