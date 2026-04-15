// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import {PanoramaExecutorV2} from "../contracts/aerodrome/core/PanoramaExecutorV2.sol";
import {MoonwellLendAdapter} from "../contracts/base/adapters/MoonwellLendAdapter.sol";
import {UpgradeableBeacon} from "@openzeppelin/contracts/proxy/beacon/UpgradeableBeacon.sol";

/**
 * @title Deploy_MoonwellBeacon
 * @notice Deploys MoonwellLendAdapter + UpgradeableBeacon and registers it
 *         in a pre-existing PanoramaExecutorV2 on Base mainnet.
 *
 * @dev Usage:
 *      source .env
 *      forge script script/Deploy_MoonwellBeacon.s.sol \
 *        --rpc-url $BASE_RPC_URL \
 *        --broadcast \
 *        --verify \
 *        --etherscan-api-key $BASESCAN_API_KEY
 *
 *      Required env vars:
 *        PRIVATE_KEY          — deployer private key
 *        EXECUTOR_ADDRESS     — deployed PanoramaExecutorV2 address on Base
 *
 *      To upgrade all user adapters later:
 *        moonwellBeacon.upgradeTo(newMoonwellAdapterV2Address)
 */
contract Deploy_MoonwellBeacon is Script {
    // ── Base mainnet addresses ────────────────────────────────────────────────
    address constant MOONWELL_COMPTROLLER = 0xfBb21d0380beE3312B33c4353c8936a0F13EF26C;
    address constant WETH_BASE            = 0x4200000000000000000000000000000000000006;

    bytes32 constant MOONWELL_ID = keccak256("moonwell");

    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer           = vm.addr(deployerPrivateKey);
        address payable executorAddress = payable(vm.envAddress("EXECUTOR_ADDRESS"));

        PanoramaExecutorV2 executor = PanoramaExecutorV2(executorAddress);

        vm.startBroadcast(deployerPrivateKey);

        // 1. Deploy MoonwellLendAdapter implementation
        MoonwellLendAdapter adapterImpl = new MoonwellLendAdapter();
        console.log("MoonwellLendAdapter implementation:", address(adapterImpl));

        // 2. Deploy UpgradeableBeacon
        UpgradeableBeacon moonwellBeacon = new UpgradeableBeacon(address(adapterImpl), deployer);
        console.log("Moonwell UpgradeableBeacon:", address(moonwellBeacon));

        // 3. Register beacon in the existing executor
        //    initArgs = abi.encode(comptroller, weth)
        bytes memory initArgs = abi.encode(MOONWELL_COMPTROLLER, WETH_BASE);
        executor.registerBeacon(MOONWELL_ID, address(moonwellBeacon), initArgs);
        console.log("Moonwell beacon registered in executor");

        vm.stopBroadcast();

        console.log("\n=== Moonwell Beacon Deployment Summary ===");
        console.log("Chain:               Base Mainnet (8453)");
        console.log("Executor:           ", executorAddress);
        console.log("Moonwell Beacon:    ", address(moonwellBeacon));
        console.log("Adapter Impl:       ", address(adapterImpl));
        console.log("Protocol ID (moonwell):", vm.toString(MOONWELL_ID));
        console.log("Comptroller:        ", MOONWELL_COMPTROLLER);
        console.log("WETH:               ", WETH_BASE);
        console.log("\nTo upgrade: moonwellBeacon.upgradeTo(newAdapterAddress)");
    }
}
