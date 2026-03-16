// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {MockERC20} from "../../mocks/MockERC20.sol";

/// @notice Mock Benqi qToken for ERC20 markets (1:1 mint/redeem ratio)
contract MockBenqiToken is MockERC20 {
    address public underlying;
    uint256 public forcedError; // set to non-zero to simulate Benqi errors

    constructor(string memory name, string memory symbol, address _underlying)
        MockERC20(name, symbol, 8)
    {
        underlying = _underlying;
    }

    function setForcedError(uint256 errorCode) external {
        forcedError = errorCode;
    }

    /// @notice Supply underlying → receive qTokens (1:1)
    function mint(uint256 mintAmount) external returns (uint256) {
        if (forcedError != 0) return forcedError;

        MockERC20(underlying).transferFrom(msg.sender, address(this), mintAmount);
        balanceOf[msg.sender] += mintAmount;
        totalSupply += mintAmount;
        return 0;
    }

    /// @notice Burn qTokens → receive underlying (1:1)
    function redeem(uint256 redeemTokens) external returns (uint256) {
        if (forcedError != 0) return forcedError;

        balanceOf[msg.sender] -= redeemTokens;
        totalSupply -= redeemTokens;
        MockERC20(underlying).transfer(msg.sender, redeemTokens);
        return 0;
    }

    /// @notice Borrow underlying (no collateral check in mock)
    function borrow(uint256 borrowAmount) external returns (uint256) {
        if (forcedError != 0) return forcedError;

        MockERC20(underlying).transfer(msg.sender, borrowAmount);
        return 0;
    }

    /// @notice Repay borrowed underlying
    function repayBorrow(uint256 repayAmount) external returns (uint256) {
        if (forcedError != 0) return forcedError;

        MockERC20(underlying).transferFrom(msg.sender, address(this), repayAmount);
        return 0;
    }
}

/// @notice Mock qiAVAX for native AVAX market
contract MockBenqiAVAX is MockERC20 {
    uint256 public forcedError;

    constructor() MockERC20("Benqi AVAX", "qiAVAX", 8) {}

    function setForcedError(uint256 errorCode) external {
        forcedError = errorCode;
    }

    /// @notice Supply AVAX → receive qiAVAX (1:1)
    function mint() external payable {
        require(forcedError == 0, "MockBenqiAVAX: forced error");
        balanceOf[msg.sender] += msg.value;
        totalSupply += msg.value;
    }

    /// @notice Burn qiAVAX → receive AVAX (1:1)
    function redeem(uint256 redeemTokens) external returns (uint256) {
        if (forcedError != 0) return forcedError;

        balanceOf[msg.sender] -= redeemTokens;
        totalSupply -= redeemTokens;
        payable(msg.sender).transfer(redeemTokens);
        return 0;
    }

    /// @notice Borrow AVAX (no collateral check in mock)
    function borrow(uint256 borrowAmount) external returns (uint256) {
        if (forcedError != 0) return forcedError;

        payable(msg.sender).transfer(borrowAmount);
        return 0;
    }

    /// @notice Repay borrowed AVAX
    function repayBorrow() external payable {
        require(forcedError == 0, "MockBenqiAVAX: forced error");
    }

    receive() external payable {}
}

/// @notice Mock Benqi Comptroller
contract MockComptroller {
    bool public shouldFail;

    function setShouldFail(bool _fail) external {
        shouldFail = _fail;
    }

    function enterMarkets(address[] calldata) external view returns (uint256[] memory results) {
        results = new uint256[](1);
        results[0] = shouldFail ? 1 : 0;
    }

    function exitMarket(address) external pure returns (uint256) {
        return 0;
    }

    function getAccountLiquidity(address) external pure returns (uint256, uint256, uint256) {
        return (0, 1000e18, 0);
    }
}
