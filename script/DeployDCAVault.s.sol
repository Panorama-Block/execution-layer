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
    // PanoramaExecutor already deployed on Base mainnet
    address constant EXECUTOR = 0x82b000512A19f7B762A23033aEA5AE00aBD0D2bC;

    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);

        vm.startBroadcast(deployerPrivateKey);

        // Keeper = deployer wallet (change to dedicated keeper address if needed)
        DCAVault vault = new DCAVault(deployer, EXECUTOR);
        PanoramaExecutor(payable(EXECUTOR)).setAuthorizedOperator(address(vault), true);

        vm.stopBroadcast();

        console.log("\n=== DCAVault Deployment ===");
        console.log("Chain:    Base Mainnet (8453)");
        console.log("Vault:   ", address(vault));
        console.log("Keeper:  ", deployer);
        console.log("Executor:", EXECUTOR);
        console.log("\nNext step after 24h delay:");
        console.log(
            "call executeAuthorizedOperatorChange(vault) on PanoramaExecutor to activate DCA automation"
        );
        console.log("\nThen add to backend/.env:");
        console.log("DCA_VAULT_ADDRESS=", address(vault));
    }
}
