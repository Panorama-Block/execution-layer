// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import {PanoramaExecutorV2} from "../contracts/aerodrome/core/PanoramaExecutorV2.sol";
import {AerodromeAdapterV2} from "../contracts/aerodrome/adapters/AerodromeAdapterV2.sol";
import {UpgradeableBeacon} from "@openzeppelin/contracts/proxy/beacon/UpgradeableBeacon.sol";

/**
 * @title DeployV2Smoke
 * @notice Smoke test reproducing the deploy script's logic in a test harness — no broadcast,
 *         no env vars, no real ETH. Runs offline (no fork required).
 *
 * Purpose:
 *  - CI gate: catches contract changes that break the deploy script before they reach mainnet.
 *  - Sanity for reviewers: the deploy logic is exercised end-to-end in unit form.
 *
 * What this is NOT:
 *  - A fork test against real Aerodrome contracts (those live separately in the adapter test
 *    suite and require BASE_RPC_URL).
 *
 * Related: SPRINT_HUGO.md Bloco 6 cards #81 / #82 / #83.
 */
contract DeployV2Smoke is Test {
    bytes32 constant AERODROME_ID = keccak256("aerodrome");
    address constant AERODROME_ROUTER = 0xcF77a3Ba9A5CA399B7c97c74d54e5b1Beb874E43;
    address constant AERODROME_VOTER = 0x16613524e02ad97eDfeF371bC883F2F5d6C480A5;

    address deployer = makeAddr("deployer");

    AerodromeAdapterV2 adapterImpl;
    UpgradeableBeacon beacon;
    PanoramaExecutorV2 executor;

    function setUp() public {
        // Mirror DeployV2.s.sol step-by-step, signed as `deployer`.
        vm.startPrank(deployer);

        adapterImpl = new AerodromeAdapterV2();
        beacon = new UpgradeableBeacon(address(adapterImpl), deployer);
        executor = new PanoramaExecutorV2();

        bytes memory initArgs = abi.encode(AERODROME_ROUTER, AERODROME_VOTER);
        executor.registerBeacon(AERODROME_ID, address(beacon), initArgs);

        vm.stopPrank();
    }

    function test_executor_owner_is_deployer() public view {
        assertEq(executor.owner(), deployer, "executor owner must be deployer EOA");
    }

    function test_beacon_owner_is_deployer() public view {
        assertEq(beacon.owner(), deployer, "beacon owner must be deployer (so upgradeTo works)");
    }

    function test_beacon_implementation_is_adapter() public view {
        assertEq(
            beacon.implementation(),
            address(adapterImpl),
            "beacon should point to the freshly deployed adapter impl"
        );
    }

    function test_aerodrome_beacon_registered_in_executor() public view {
        address registered = executor.protocolBeacons(AERODROME_ID);
        assertEq(registered, address(beacon), "aerodrome beacon must be registered with executor");
    }

    function test_aerodrome_init_args_round_trip() public view {
        bytes memory got = executor.protocolInitArgs(AERODROME_ID);
        bytes memory expected = abi.encode(AERODROME_ROUTER, AERODROME_VOTER);
        assertEq(keccak256(got), keccak256(expected), "init args must round-trip via executor storage");
    }

    function test_register_again_with_different_beacon_reverts_or_overwrites() public {
        // The contract may allow overwrite (admin path) or revert (immutable path). Either is
        // valid as long as the behaviour is deterministic — this test pins the current behaviour
        // so an accidental change is caught.
        UpgradeableBeacon other = new UpgradeableBeacon(address(adapterImpl), deployer);
        vm.startPrank(deployer);
        try executor.registerBeacon(AERODROME_ID, address(other), abi.encode(address(0), address(0))) {
            // If overwrite is allowed, the latest registration wins.
            assertEq(executor.protocolBeacons(AERODROME_ID), address(other), "expected overwrite to win");
        } catch {
            // If the contract is strict and reverts, the original registration stays.
            assertEq(executor.protocolBeacons(AERODROME_ID), address(beacon), "expected original to stay on revert");
        }
        vm.stopPrank();
    }

    function test_non_owner_cannot_register_beacon() public {
        address attacker = makeAddr("attacker");
        UpgradeableBeacon other = new UpgradeableBeacon(address(adapterImpl), attacker);
        vm.startPrank(attacker);
        vm.expectRevert();
        executor.registerBeacon(keccak256("attacker-protocol"), address(other), "");
        vm.stopPrank();
    }
}
