// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import {PanoramaExecutor} from "../contracts/core/PanoramaExecutor.sol";
import {AerodromeAdapter} from "../contracts/adapters/AerodromeAdapter.sol";

/**
 * @title Deploy
 * @notice Deployment script for Base mainnet.
 * @dev Usage:
 *      source .env
 *      forge script script/Deploy.s.sol --rpc-url $BASE_RPC_URL --broadcast --verify
 */
contract Deploy is Script {
    // Aerodrome Base mainnet addresses
    address constant AERODROME_ROUTER = 0xcF77a3Ba9A5CA399B7c97c74d54e5b1Beb874E43;
    address constant AERODROME_VOTER = 0x16613524e02ad97eDfeF371bC883F2F5d6C480A5;

    bytes32 constant AERODROME_ID = keccak256("aerodrome");

    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");

        vm.startBroadcast(deployerPrivateKey);

        // 1. Deploy PanoramaExecutor
        PanoramaExecutor executor = new PanoramaExecutor();
        console.log("PanoramaExecutor deployed at:", address(executor));

        // 2. Deploy AerodromeAdapter
        AerodromeAdapter adapter = new AerodromeAdapter(AERODROME_ROUTER, AERODROME_VOTER, address(executor));
        console.log("AerodromeAdapter deployed at:", address(adapter));

        // 3. Register adapter in executor
        executor.registerAdapter(AERODROME_ID, address(adapter));
        console.log("AerodromeAdapter registered with protocol ID: aerodrome");

        vm.stopBroadcast();

        // Output summary
        console.log("\n=== Deployment Summary ===");
        console.log("Chain: Base Mainnet (8453)");
        console.log("Executor:", address(executor));
        console.log("Aerodrome Adapter:", address(adapter));
        console.log("Protocol ID (aerodrome):", vm.toString(AERODROME_ID));
    }
}
