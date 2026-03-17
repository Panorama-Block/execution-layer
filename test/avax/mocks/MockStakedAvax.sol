// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {MockERC20} from "../../mocks/MockERC20.sol";
import {IStakedAvax} from "../../../contracts/avax/interfaces/IStakedAvax.sol";

/// @notice Mock BENQI sAVAX for unit testing PanoramaLiquidStack
/// @dev submit() mints sAVAX 1:1 with AVAX. requestUnlock/redeem simulate cooldown tracking.
contract MockStakedAvax is MockERC20, IStakedAvax {
    uint256 public pooledAvax;
    bool public redeemFails;

    // unlock requests per address
    mapping(address => IStakedAvax.UnlockRequest[]) private _unlockRequests;

    constructor() MockERC20("Staked AVAX", "sAVAX", 18) {}

    function setRedeemFails(bool fails) external {
        redeemFails = fails;
    }

    // ─── IStakedAvax ──────────────────────────────────────────────────────

    function submit() external payable override returns (uint256 shareAmount) {
        require(msg.value > 0, "MockStakedAvax: zero value");
        shareAmount = getSharesByPooledAvax(msg.value);
        pooledAvax += msg.value;
        balanceOf[msg.sender] += shareAmount;
        totalSupply += shareAmount;
    }

    function requestUnlock(uint256 shareAmount) external override {
        require(shareAmount > 0, "MockStakedAvax: zero amount");
        require(balanceOf[msg.sender] >= shareAmount, "MockStakedAvax: insufficient balance");
        balanceOf[msg.sender] -= shareAmount;
        totalSupply -= shareAmount;
        _unlockRequests[msg.sender].push(IStakedAvax.UnlockRequest({
            shareAmount: shareAmount,
            unlockTime: block.timestamp
        }));
    }

    function redeem(uint256 unlockRequestIndex) external override {
        require(!redeemFails, "MockStakedAvax: redeem failed");
        UnlockRequest[] storage requests = _unlockRequests[msg.sender];
        require(unlockRequestIndex < requests.length, "MockStakedAvax: invalid index");

        uint256 shareAmount = requests[unlockRequestIndex].shareAmount;
        uint256 avaxAmount = getPooledAvaxByShares(shareAmount);

        // Remove request (swap with last)
        requests[unlockRequestIndex] = requests[requests.length - 1];
        requests.pop();

        pooledAvax -= avaxAmount;
        payable(msg.sender).transfer(avaxAmount);
    }

    function getSharesByPooledAvax(uint256 avaxAmount) public view override returns (uint256) {
        if (totalSupply == 0 || pooledAvax == 0) return avaxAmount; // 1:1 initially
        return (avaxAmount * totalSupply) / pooledAvax;
    }

    function getPooledAvaxByShares(uint256 shareAmount) public view override returns (uint256) {
        if (totalSupply == 0 || pooledAvax == 0) return shareAmount; // 1:1 initially
        return (shareAmount * pooledAvax) / totalSupply;
    }

    function totalPooledAvax() external view override returns (uint256) {
        return pooledAvax;
    }

    function totalShares() external view override returns (uint256) {
        return totalSupply;
    }

    function getUnlockRequest(address user, uint256 index)
        external view override
        returns (IStakedAvax.UnlockRequest memory)
    {
        UnlockRequest storage r = _unlockRequests[user][index];
        return IStakedAvax.UnlockRequest({ shareAmount: r.shareAmount, unlockTime: r.unlockTime });
    }

    function getUnlockRequestCount(address user) external view override returns (uint256) {
        return _unlockRequests[user].length;
    }

    receive() external payable {}
}
