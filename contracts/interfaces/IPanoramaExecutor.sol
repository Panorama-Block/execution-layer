// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IPanoramaExecutor {
    struct Transfer {
        address token;
        uint256 amount;
    }

    function execute(
        bytes32 protocolId,
        bytes4 action,
        Transfer[] calldata transfers,
        uint256 deadline,
        bytes calldata data
    ) external payable returns (bytes memory result);

    function executeSwapFor(
        address user,
        bytes32 protocolId,
        bytes4 action,
        Transfer[] calldata transfers,
        uint256 deadline,
        bytes calldata data
    ) external payable returns (bytes memory result);
}
