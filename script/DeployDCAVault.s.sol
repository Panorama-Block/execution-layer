// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import {DCAVault} from "../contracts/core/DCAVault.sol";
import {PanoramaExecutor} from "../contracts/core/PanoramaExecutor.sol";

/**
 * @title DeployDCAVault
 * @notice Deploys DCAVault on Base mainnet.
 * @dev Usage:
 *      source .env
 *      forge script script/DeployDCAVault.s.sol --rpc-url $BASE_RPC_URL --broadcast --verify
 */
contract DeployDCAVault is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer  = vm.addr(deployerPrivateKey);
        address payable executor = payable(vm.envAddress("EXECUTOR_ADDRESS"));

        vm.startBroadcast(deployerPrivateKey);

        // Keeper = deployer wallet (change to dedicated keeper address if needed)
        DCAVault vault = new DCAVault(deployer, executor);

        // Authorise the vault to call PanoramaExecutor.executeSwapFor on behalf of users
        PanoramaExecutor(executor).setAuthorizedOperator(address(vault), true);

        vm.stopBroadcast();

        console.log("\n=== DCAVault Deployment ===");
        console.log("Chain:    Base Mainnet (8453)");
        console.log("Vault:   ", address(vault));
        console.log("Keeper:  ", deployer);
        console.log("Executor:", executor);
        console.log("Vault authorised as executor operator: true");
        console.log("Note: keeper/owner changes require 24h delay before acceptance.");
        console.log("\nNext step: add to backend/.env:");
        console.log("DCA_VAULT_ADDRESS=", address(vault));
    }
}
