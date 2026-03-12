// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import {AerodromeAdapter} from "../contracts/adapters/AerodromeAdapter.sol";
import {PanoramaExecutor} from "../contracts/core/PanoramaExecutor.sol";

/**
 * @title MigrateAdapter
 * @notice Migration script for upgrading AerodromeAdapter to the generic execute() interface.
 *
 * @dev Deployment sequence:
 *   1. Deploy new AerodromeAdapter (new address, new logic).
 *   2. For each user with an existing clone (enumerate UserAdapterCreated events off-chain),
 *      call executor.clearUserAdapter(AERODROME_ID, user). Their next interaction will
 *      create a fresh clone pointing to the new implementation.
 *   3. Call executor.registerAdapter(AERODROME_ID, newAdapterAddress).
 *   4. Redeploy DCAVault pointing to the same executor; update backend config.
 *
 * Run:
 *   forge script script/MigrateAdapter.s.sol --rpc-url $BASE_RPC_URL --broadcast
 *
 * Environment variables required:
 *   PANORAMA_EXECUTOR   — address of deployed PanoramaExecutor
 *   AERODROME_ROUTER    — 0xcF77a3Ba9A5CA399B7c97c74d54e5b1Beb874E43
 *   AERODROME_VOTER     — 0x16613524e02ad97eDfeF371bC883F2F5d6C480A5
 */
contract MigrateAdapter is Script {
    bytes32 constant AERODROME_ID = keccak256("aerodrome");

    function run() external {
        address payable executorAddr = payable(vm.envAddress("PANORAMA_EXECUTOR"));
        address routerAddr           = vm.envAddress("AERODROME_ROUTER");
        address voterAddr            = vm.envAddress("AERODROME_VOTER");

        vm.startBroadcast();

        // Step 1: Deploy new AerodromeAdapter
        AerodromeAdapter newAdapter = new AerodromeAdapter(routerAddr, voterAddr, executorAddr);
        console.log("New AerodromeAdapter deployed at:", address(newAdapter));

        // Step 2: Register new implementation (replaces old one)
        // NOTE: Before calling this in production, enumerate UserAdapterCreated events
        // and call executor.clearUserAdapter(AERODROME_ID, user) for each affected user.
        // This script only registers the new implementation; clearing is done separately
        // to allow batching over potentially many users.
        PanoramaExecutor(executorAddr).registerAdapter(AERODROME_ID, address(newAdapter));
        console.log("Registered new adapter for AERODROME_ID");

        vm.stopBroadcast();

        console.log("Migration complete.");
        console.log("IMPORTANT: Enumerate UserAdapterCreated events and clear existing user adapters");
        console.log("using executor.clearUserAdapter(AERODROME_ID, user) for each affected address.");
    }
}
