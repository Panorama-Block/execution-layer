// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import {PanoramaExecutorV2} from "../contracts/aerodrome/core/PanoramaExecutorV2.sol";
import {AerodromeAdapterV2} from "../contracts/aerodrome/adapters/AerodromeAdapterV2.sol";
import {UpgradeableBeacon} from "@openzeppelin/contracts/proxy/beacon/UpgradeableBeacon.sol";

/**
 * @title DeployV2
 * @notice Canonical deploy script for PanoramaExecutorV2 + AerodromeAdapterV2 on Base mainnet.
 *
 * Cards covered: SPRINT_HUGO.md #81 (Deploy PanoramaExecutor) + #82 (Deploy Aerodrome adapter)
 * + #83 (Register adapter). Card #84 (verify) is handled by `--verify` flag below.
 *
 * @dev Usage:
 *
 *      # Smoke fork (dry run — no broadcast, no funds needed):
 *      forge script script/DeployV2.s.sol \
 *        --rpc-url $BASE_RPC_URL \
 *        --sender $(cast wallet address --private-key $PRIVATE_KEY)
 *
 *      # Real broadcast:
 *      source .env
 *      forge script script/DeployV2.s.sol \
 *        --rpc-url $BASE_RPC_URL \
 *        --broadcast --verify \
 *        --etherscan-api-key $BASESCAN_API_KEY
 *
 *      Deploys (in order):
 *        1. AerodromeAdapterV2 (implementation — never called directly by users)
 *        2. UpgradeableBeacon pointing to AerodromeAdapterV2
 *        3. PanoramaExecutorV2
 *        4. Calls executor.registerBeacon(AERODROME_ID, beacon, initArgs)
 *
 *      Then writes deployments/<chain-slug>/<Contract>.json artifacts via vm.writeJson.
 *      Commit these JSONs as part of the deploy PR (see deployments/_template/README.md).
 *
 *      To upgrade all user adapters later (storage-compatible only):
 *        beacon.upgradeTo(newAdapterV3Address)
 */
contract DeployV2 is Script {
    // -------------------------------------------------------------------------------------------------
    // Constants — Aerodrome on Base mainnet
    // -------------------------------------------------------------------------------------------------

    address constant AERODROME_ROUTER = 0xcF77a3Ba9A5CA399B7c97c74d54e5b1Beb874E43;
    address constant AERODROME_VOTER = 0x16613524e02ad97eDfeF371bC883F2F5d6C480A5;
    bytes32 constant AERODROME_ID = keccak256("aerodrome");

    function run() external {
        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);
        uint256 chainId = block.chainid;
        string memory chainSlug = _chainSlug(chainId);

        console.log("=== DeployV2 ===");
        console.log("Chain:", chainSlug);
        console.log("Chain ID:", chainId);
        console.log("Deployer:", deployer);
        console.log("");

        vm.startBroadcast(deployerPrivateKey);

        // 1. Deploy AerodromeAdapterV2 implementation (never called directly by users)
        AerodromeAdapterV2 adapterImpl = new AerodromeAdapterV2();
        console.log("[1/4] AerodromeAdapterV2 implementation:", address(adapterImpl));

        // 2. Deploy UpgradeableBeacon pointing to the implementation
        //    The beacon owner (deployer) can call beacon.upgradeTo(newImpl) to upgrade ALL users.
        UpgradeableBeacon aerodromeBeacon = new UpgradeableBeacon(address(adapterImpl), deployer);
        console.log("[2/4] Aerodrome UpgradeableBeacon:", address(aerodromeBeacon));

        // 3. Deploy PanoramaExecutorV2
        PanoramaExecutorV2 executor = new PanoramaExecutorV2();
        console.log("[3/4] PanoramaExecutorV2:", address(executor));

        // 4. Register beacon + protocol init args in executor
        //    initArgs for Aerodrome: abi.encode(router, voter)
        bytes memory aerodromeInitArgs = abi.encode(AERODROME_ROUTER, AERODROME_VOTER);
        executor.registerBeacon(AERODROME_ID, address(aerodromeBeacon), aerodromeInitArgs);
        console.log("[4/4] Aerodrome beacon registered with executor");

        vm.stopBroadcast();

        // -----------------------------------------------------------------------------------------------
        // Persist artifacts to deployments/<chain-slug>/<Contract>.json
        //
        // We write JSON during the script even in dry-run mode so operators can review the file diff
        // before broadcasting. In production runs (--broadcast), the addresses are real;
        // in fork runs (no --broadcast), addresses reflect what *would* be deployed at the
        // current nonce — still useful for review.
        // -----------------------------------------------------------------------------------------------

        _writeArtifact(
            chainSlug,
            "PanoramaExecutorV2",
            address(executor),
            deployer,
            chainId,
            "[]",
            "contracts/aerodrome/core/PanoramaExecutorV2.sol"
        );
        _writeArtifact(
            chainSlug,
            "AerodromeAdapterV2",
            address(adapterImpl),
            deployer,
            chainId,
            "[]",
            "contracts/aerodrome/adapters/AerodromeAdapterV2.sol"
        );
        _writeArtifact(
            chainSlug,
            "AerodromeBeacon",
            address(aerodromeBeacon),
            deployer,
            chainId,
            string.concat(
                "[\"", vm.toString(address(adapterImpl)),
                "\",\"", vm.toString(deployer),
                "\"]"
            ),
            "@openzeppelin/contracts/proxy/beacon/UpgradeableBeacon.sol"
        );

        // -----------------------------------------------------------------------------------------------
        // Summary
        // -----------------------------------------------------------------------------------------------

        console.log("");
        console.log("=== Deployment Summary ===");
        console.log(string.concat("Chain: ", chainSlug, " (", vm.toString(chainId), ")"));
        console.log("ExecutorV2:           ", address(executor));
        console.log("Aerodrome Beacon:     ", address(aerodromeBeacon));
        console.log("Aerodrome Adapter:    ", address(adapterImpl));
        console.log("Protocol ID:          ", vm.toString(AERODROME_ID));
        console.log("");
        console.log(string.concat("Artifacts written to deployments/", chainSlug, "/"));
        console.log("");
        console.log("Next steps:");
        console.log("  1. Commit the generated *.json files");
        console.log("  2. If --verify was used: confirm BaseScan verification badge on each address");
        console.log("  3. Point backend services to the new ExecutorV2 address");
        console.log("  4. Announce in #panorama-dev with addresses + tx links");
    }

    // -------------------------------------------------------------------------------------------------
    // Helpers
    // -------------------------------------------------------------------------------------------------

    /// @notice Map chain id → slug used in deployments/<slug>/ paths.
    ///         Must match `backend/shared/capability/chains/<slug>.manifest.json`.
    function _chainSlug(uint256 chainId) internal pure returns (string memory) {
        if (chainId == 8453) return "base";
        if (chainId == 84532) return "base-sepolia";
        if (chainId == 43114) return "avalanche";
        if (chainId == 1) return "ethereum";
        // Fallback: write to deployments/<id>/ so the operator can rename.
        return string.concat("chain-", vm.toString(chainId));
    }

    function _writeArtifact(
        string memory chainSlug,
        string memory contractName,
        address addr,
        address deployer,
        uint256 chainId,
        string memory constructorArgsJsonArray,
        string memory sourcePath
    ) internal {
        // Build a stable JSON shape. Fields without on-chain provenance (blockNumber, txHash,
        // deployedAt) are filled with "TBD" because vm.writeJson runs inside the script and we
        // can't easily get the inclusion block in the same call — the operator updates these
        // post-broadcast via the checklist (deployments/_template/README.md, step 5).
        string memory path = string.concat("deployments/", chainSlug, "/", contractName, ".json");

        string memory json = string.concat(
            "{\n",
            "  \"contract\": \"", contractName, "\",\n",
            "  \"address\": \"", vm.toString(addr), "\",\n",
            "  \"deployer\": \"", vm.toString(deployer), "\",\n",
            "  \"chainId\": ", vm.toString(chainId), ",\n",
            "  \"blockNumber\": 0,\n",
            "  \"txHash\": \"0x_TBD_AFTER_BROADCAST\",\n",
            "  \"deployedAt\": \"TBD_AFTER_BROADCAST\",\n",
            "  \"verified\": false,\n",
            "  \"verifiedUrl\": \"\",\n",
            "  \"constructorArgs\": ", constructorArgsJsonArray, ",\n",
            "  \"compiler\": \"0.8.24\",\n",
            "  \"optimizer\": { \"enabled\": true, \"runs\": 200 },\n",
            "  \"source\": \"", sourcePath, "\",\n",
            "  \"deployScript\": \"script/DeployV2.s.sol\",\n",
            "  \"notes\": \"Auto-written by DeployV2.s.sol. Update blockNumber/txHash/deployedAt/verified after broadcast (see deployments/_template/README.md step 5).\"\n",
            "}\n"
        );

        vm.writeFile(path, json);
        console.log("Wrote artifact:", path);
    }
}
