// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title AdapterSelectors
 * @notice Constants for protocol adapter operation selectors.
 * @dev Values match bytes4(keccak256("operationName")).
 */
library AdapterSelectors {
    bytes4 internal constant SWAP             = bytes4(keccak256("swap"));
    bytes4 internal constant ADD_LIQUIDITY    = bytes4(keccak256("addLiquidity"));
    bytes4 internal constant REMOVE_LIQUIDITY = bytes4(keccak256("removeLiquidity"));
    bytes4 internal constant STAKE            = bytes4(keccak256("stake"));
    bytes4 internal constant UNSTAKE          = bytes4(keccak256("unstake"));
    bytes4 internal constant CLAIM_REWARDS    = bytes4(keccak256("claimRewards"));
}
