// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import {PanoramaExecutor} from "../contracts/core/PanoramaExecutor.sol";
import {AerodromeAdapter} from "../contracts/adapters/AerodromeAdapter.sol";

/**
 * @title DeployTestnet
 * @notice Deployment script for Base Sepolia testnet.
 * @dev Aerodrome does not exist on Sepolia, so this deploys with mock addresses.
 *      For real testing, use mainnet fork: forge test --fork-url $BASE_RPC_URL
 *
 *      Usage:
 *      source .env
 *      forge script script/DeployTestnet.s.sol --rpc-url $BASE_SEPOLIA_RPC_URL --broadcast
 */
contract DeployTestnet is Script {
    // Placeholder addresses for testnet (replace with mock deployments)
    address constant MOCK_ROUTER = address(0);
    address constant MOCK_VOTER = address(0);

    bytes32 constant AERODROME_ID = keccak256("aerodrome");

    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");

        vm.startBroadcast(deployerPrivateKey);

        // 1. Deploy PanoramaExecutor
        PanoramaExecutor executor = new PanoramaExecutor();
        console.log("PanoramaExecutor deployed at:", address(executor));

        // Note: On testnet, you would deploy MockRouter first and use its address here.
        // AerodromeAdapter requires valid router and voter addresses.
        // For testnet, consider deploying mock contracts or just testing via mainnet fork.

        console.log("\n=== Testnet Deployment ===");
        console.log("Chain: Base Sepolia");
        console.log("Executor:", address(executor));
        console.log("Note: Deploy mock router/voter for full adapter testing on testnet.");

        vm.stopBroadcast();
    }
}
