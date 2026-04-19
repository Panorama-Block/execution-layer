// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import {MetronomeAdapter} from "../../contracts/base/adapters/MetronomeAdapter.sol";
import {PanoramaExecutorV2} from "../../contracts/aerodrome/core/PanoramaExecutorV2.sol";
import {UpgradeableBeacon} from "@openzeppelin/contracts/proxy/beacon/UpgradeableBeacon.sol";

/**
 * @title Deploy_MetronomeBeacon
 * @notice Adds Metronome as a new protocol on Base to an existing PanoramaExecutorV2.
 * @dev Usage:
 *      source .env
 *      forge script script/base/Deploy_MetronomeBeacon.s.sol \
 *          --rpc-url $BASE_RPC_URL \
 *          --broadcast --verify
 *
 *      Required env vars:
 *        PRIVATE_KEY          — deployer key (must also be executor owner)
 *        EXECUTOR_V2_ADDRESS  — already-deployed PanoramaExecutorV2 on Base
 *
 *      Deploys:
 *        1. MetronomeAdapter implementation
 *        2. UpgradeableBeacon pointing to (1)
 *        3. registerBeacon(keccak256("metronome"), beacon, abi.encode(pool, poolRegistry))
 */
contract Deploy_MetronomeBeacon is Script {
    // ── Metronome Synth — Base mainnet (8453) ───────────────────────────────
    address constant METRONOME_POOL = 0xc614136d6c5AB85bc2aCF0ec2652351642d7F54E;
    address constant METRONOME_POOL_REGISTRY = 0x4372A2b9304296c06197a823f25Cf03119d2Fd82;

    bytes32 constant METRONOME_ID = keccak256("metronome");

    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);
        address executorAddress = vm.envAddress("EXECUTOR_V2_ADDRESS");

        vm.startBroadcast(deployerPrivateKey);

        // 1. Adapter implementation
        MetronomeAdapter impl = new MetronomeAdapter();
        console.log("MetronomeAdapter impl:", address(impl));

        // 2. Beacon (deployer is initial owner — can transfer to executor owner later)
        UpgradeableBeacon beacon = new UpgradeableBeacon(address(impl), deployer);
        console.log("Metronome beacon:", address(beacon));

        // 3. Register with the existing executor
        PanoramaExecutorV2 executor = PanoramaExecutorV2(payable(executorAddress));
        executor.registerBeacon(
            METRONOME_ID,
            address(beacon),
            abi.encode(METRONOME_POOL, METRONOME_POOL_REGISTRY)
        );

        vm.stopBroadcast();

        console.log("\n=== Metronome Registration Summary ===");
        console.log("Chain: Base mainnet (8453)");
        console.log("Executor:", executorAddress);
        console.log("Protocol ID:", uint256(METRONOME_ID));
        console.log("Adapter impl:", address(impl));
        console.log("Beacon:", address(beacon));
        console.log("Metronome Pool:", METRONOME_POOL);
        console.log("Metronome PoolRegistry:", METRONOME_POOL_REGISTRY);
    }
}
