// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import {PanoramaExecutorV2} from "../../contracts/aerodrome/core/PanoramaExecutorV2.sol";
import {TraderJoeAdapter} from "../../contracts/avax/adapters/TraderJoeAdapter.sol";
import {BenqiLendAdapter} from "../../contracts/avax/adapters/BenqiLendAdapter.sol";
import {SAVAXAdapter} from "../../contracts/avax/adapters/SAVAXAdapter.sol";
import {UpgradeableBeacon} from "@openzeppelin/contracts/proxy/beacon/UpgradeableBeacon.sol";

/**
 * @title DeployAvaxV2
 * @notice Deployment script for PanoramaExecutorV2 + all adapters on Avalanche C-Chain.
 * @dev Usage:
 *      source .env
 *      forge script script/avax/DeployAvaxV2.s.sol --rpc-url $AVAX_RPC_URL --broadcast --verify
 *
 *      Deploys:
 *        1. TraderJoeAdapter impl + UpgradeableBeacon
 *        2. BenqiLendAdapter impl + UpgradeableBeacon
 *        3. SAVAXAdapter impl + UpgradeableBeacon
 *        4. PanoramaExecutorV2 (same contract, deployed on Avalanche)
 *        5. Registers all 3 beacons + initArgs
 */
contract DeployAvaxV2 is Script {
    // Avalanche C-Chain addresses
    address constant TRADER_JOE_ROUTER = 0x60aE616a2155Ee3d9A68541Ba4544862310933d4;
    address constant BENQI_COMPTROLLER = 0x486Af39519B4Dc9a7fCcd318217352830E8AD9b4;
    address constant QI_AVAX = 0x5C0401e81Bc07Ca70fAD469b451682c0d747Ef1c;
    address constant S_AVAX = 0x2b2C81e08f1Af8835a78Bb2A90AE924ACE0eA4bE;

    bytes32 constant TRADERJOE_ID = keccak256("traderjoe");
    bytes32 constant BENQI_ID = keccak256("benqi");
    bytes32 constant SAVAX_ID = keccak256("savax");

    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);

        vm.startBroadcast(deployerPrivateKey);

        // ── 1. TraderJoeAdapter ─────────────────────────────────────────────
        TraderJoeAdapter traderJoeImpl = new TraderJoeAdapter();
        UpgradeableBeacon traderJoeBeacon = new UpgradeableBeacon(address(traderJoeImpl), deployer);
        console.log("TraderJoeAdapter impl:", address(traderJoeImpl));
        console.log("TraderJoe beacon:", address(traderJoeBeacon));

        // ── 2. BenqiLendAdapter ─────────────────────────────────────────────
        BenqiLendAdapter benqiImpl = new BenqiLendAdapter();
        UpgradeableBeacon benqiBeacon = new UpgradeableBeacon(address(benqiImpl), deployer);
        console.log("BenqiLendAdapter impl:", address(benqiImpl));
        console.log("Benqi beacon:", address(benqiBeacon));

        // ── 3. SAVAXAdapter ─────────────────────────────────────────────────
        SAVAXAdapter savaxImpl = new SAVAXAdapter();
        UpgradeableBeacon savaxBeacon = new UpgradeableBeacon(address(savaxImpl), deployer);
        console.log("SAVAXAdapter impl:", address(savaxImpl));
        console.log("sAVAX beacon:", address(savaxBeacon));

        // ── 4. PanoramaExecutorV2 ───────────────────────────────────────────
        PanoramaExecutorV2 executor = new PanoramaExecutorV2();
        console.log("PanoramaExecutorV2:", address(executor));

        // ── 5. Register all beacons ─────────────────────────────────────────
        executor.registerBeacon(TRADERJOE_ID, address(traderJoeBeacon), abi.encode(TRADER_JOE_ROUTER));
        executor.registerBeacon(BENQI_ID, address(benqiBeacon), abi.encode(BENQI_COMPTROLLER, QI_AVAX));
        executor.registerBeacon(SAVAX_ID, address(savaxBeacon), abi.encode(S_AVAX));

        console.log("All beacons registered");

        vm.stopBroadcast();

        // Output summary
        console.log("\n=== Avalanche V2 Deployment Summary ===");
        console.log("Chain: Avalanche C-Chain (43114)");
        console.log("ExecutorV2:", address(executor));
        console.log("TraderJoe Beacon:", address(traderJoeBeacon));
        console.log("Benqi Beacon:", address(benqiBeacon));
        console.log("sAVAX Beacon:", address(savaxBeacon));
        console.log("\nProtocol IDs:");
        console.log("  traderjoe:", vm.toString(TRADERJOE_ID));
        console.log("  benqi:", vm.toString(BENQI_ID));
        console.log("  savax:", vm.toString(SAVAX_ID));
        console.log("\nTo upgrade: beacon.upgradeTo(newImplAddress)");
    }
}
