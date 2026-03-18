// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import {PanoramaExecutorV2} from "../contracts/aerodrome/core/PanoramaExecutorV2.sol";
import {AerodromeAdapterV2} from "../contracts/aerodrome/adapters/AerodromeAdapterV2.sol";
import {UpgradeableBeacon} from "@openzeppelin/contracts/proxy/beacon/UpgradeableBeacon.sol";

/**
 * @title DeployV2
 * @notice Deployment script for PanoramaExecutorV2 + AerodromeAdapterV2 on Base mainnet.
 * @dev Usage:
 *      source .env
 *      forge script script/DeployV2.s.sol --rpc-url $BASE_RPC_URL --broadcast --verify
 *
 *      Deploys:
 *        1. AerodromeAdapterV2 (implementation — never called directly)
 *        2. UpgradeableBeacon pointing to AerodromeAdapterV2
 *        3. PanoramaExecutorV2
 *        4. Registers beacon + initArgs in executor
 *
 *      To upgrade all user adapters later:
 *        beacon.upgradeTo(newAdapterV3Address)
 */
contract DeployV2 is Script {
    // Aerodrome Base mainnet addresses
    address constant AERODROME_ROUTER = 0xcF77a3Ba9A5CA399B7c97c74d54e5b1Beb874E43;
    address constant AERODROME_VOTER = 0x16613524e02ad97eDfeF371bC883F2F5d6C480A5;

    bytes32 constant AERODROME_ID = keccak256("aerodrome");

    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);

        vm.startBroadcast(deployerPrivateKey);

        // 1. Deploy AerodromeAdapterV2 implementation (never called directly by users)
        AerodromeAdapterV2 adapterImpl = new AerodromeAdapterV2();
        console.log("AerodromeAdapterV2 implementation:", address(adapterImpl));

        // 2. Deploy UpgradeableBeacon pointing to the implementation
        //    The beacon owner (deployer) can call beacon.upgradeTo(newImpl) to upgrade ALL users.
        UpgradeableBeacon aerodromeBeacon = new UpgradeableBeacon(address(adapterImpl), deployer);
        console.log("Aerodrome UpgradeableBeacon:", address(aerodromeBeacon));

        // 3. Deploy PanoramaExecutorV2
        PanoramaExecutorV2 executor = new PanoramaExecutorV2();
        console.log("PanoramaExecutorV2:", address(executor));

        // 4. Register beacon + protocol init args in executor
        //    initArgs for Aerodrome: abi.encode(router, voter)
        bytes memory aerodromeInitArgs = abi.encode(AERODROME_ROUTER, AERODROME_VOTER);
        executor.registerBeacon(AERODROME_ID, address(aerodromeBeacon), aerodromeInitArgs);
        console.log("Aerodrome beacon registered with executor");

        vm.stopBroadcast();

        // Output summary
        console.log("\n=== Base V2 Deployment Summary ===");
        console.log("Chain: Base Mainnet (8453)");
        console.log("ExecutorV2:", address(executor));
        console.log("Aerodrome Beacon:", address(aerodromeBeacon));
        console.log("Aerodrome Adapter Impl:", address(adapterImpl));
        console.log("Protocol ID (aerodrome):", vm.toString(AERODROME_ID));
        console.log("\nTo upgrade all users: aerodromeBeacon.upgradeTo(newImplAddress)");
    }
}
