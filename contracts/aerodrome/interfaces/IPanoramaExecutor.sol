// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IPanoramaExecutor {
    struct TokenTransfer {
        address token;
        uint256 amount;
    }

    function execute(
        bytes32 protocolId,
        bytes4 selector,
        TokenTransfer[] calldata transfers,
        uint256 deadline,
        bytes calldata adapterData
    ) external;
}
