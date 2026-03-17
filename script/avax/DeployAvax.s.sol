// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script, console} from "forge-std/Script.sol";
import {PanoramaSwap} from "../../contracts/avax/core/PanoramaSwap.sol";
import {PanoramaLend} from "../../contracts/avax/lending/PanoramaLend.sol";
import {PanoramaLiquidStaking} from "../../contracts/avax/liquid-staking/PanoramaLiquidStaking.sol";

/// @notice Deploy PanoramaSwap, PanoramaLend and PanoramaLiquidStaking to Avalanche C-Chain mainnet
///
/// Usage:
///   source .env
///   forge script script/avax/DeployAvax.s.sol \
///     --rpc-url $AVAX_RPC_URL \
///     --broadcast \
///     --verify \
///     --verifier-url https://api.snowtrace.io/api \
///     --etherscan-api-key $SNOWTRACE_API_KEY \
///     -vvvv
contract DeployAvax is Script {
    // ─── Avalanche C-Chain Mainnet Addresses ──────────────────────────────

    address constant TRADER_JOE_ROUTER  = 0x60aE616a2155Ee3d9A68541Ba4544862310933d4;
    address constant BENQI_COMPTROLLER  = 0x486Af39519B4Dc9a7fCcd318217352830E8AD9b4;
    address constant QI_AVAX            = 0x5C0401e81Bc07Ca70fAD469b451682c0d747Ef1c;
    address constant S_AVAX             = 0x2b2C81e08f1Af8835a78Bb2A90AE924ACE0eA4bE; // BENQI sAVAX

    function run() external {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);

        console.log("Deployer:", deployer);
        console.log("Chain ID:", block.chainid);

        vm.startBroadcast(deployerKey);

        // Deploy PanoramaSwap
        PanoramaSwap swap = new PanoramaSwap(TRADER_JOE_ROUTER);
        console.log("PanoramaSwap deployed at:", address(swap));

        // Deploy PanoramaLend
        PanoramaLend lend = new PanoramaLend(BENQI_COMPTROLLER, QI_AVAX);
        console.log("PanoramaLend deployed at:", address(lend));

        // Deploy PanoramaLiquidStaking
        PanoramaLiquidStaking liquidStaking = new PanoramaLiquidStaking(S_AVAX);
        console.log("PanoramaLiquidStaking deployed at:", address(liquidStaking));

        vm.stopBroadcast();

        console.log("\n=== Deployment Summary ===");
        console.log("Network:              Avalanche C-Chain (43114)");
        console.log("PanoramaSwap:         ", address(swap));
        console.log("PanoramaLend:         ", address(lend));
        console.log("PanoramaLiquidStaking:  ", address(liquidStaking));
        console.log("\nNext steps:");
        console.log("1. Verify contracts on Snowtrace");
        console.log("2. Sign ownership proof with deployer wallet");
        console.log("3. Register on Retro9000 Discover Projects page");
    }
}
