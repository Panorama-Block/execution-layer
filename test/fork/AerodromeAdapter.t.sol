// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import {PanoramaExecutor} from "../../contracts/core/PanoramaExecutor.sol";
import {AerodromeAdapter} from "../../contracts/adapters/AerodromeAdapter.sol";
import {IAerodromeRouter} from "../../contracts/interfaces/IAerodromeRouter.sol";

/**
 * @title AerodromeAdapterForkTest
 * @notice Fork tests against Base mainnet Aerodrome contracts.
 * @dev Run with: forge test --match-contract AerodromeAdapterForkTest --fork-url $BASE_RPC_URL
 */
contract AerodromeAdapterForkTest is Test {
    // Base mainnet addresses
    address constant AERODROME_ROUTER = 0xcF77a3Ba9A5CA399B7c97c74d54e5b1Beb874E43;
    address constant AERODROME_VOTER = 0x16613524e02ad97eDfeF371bC883F2F5d6C480A5;
    address constant WETH_BASE = 0x4200000000000000000000000000000000000006;
    address constant USDC_BASE = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913;

    bytes4 public constant SWAP_SELECTOR =
        bytes4(keccak256("swap(address,address,uint256,uint256,address,bool)"));

    PanoramaExecutor public executor;
    AerodromeAdapter public adapter;
    bytes32 public constant AERODROME_ID = keccak256("aerodrome");

    address public user = makeAddr("user");

    function setUp() public {
        vm.createSelectFork(vm.envString("BASE_RPC_URL"));
        executor = new PanoramaExecutor();
        adapter = new AerodromeAdapter(AERODROME_ROUTER, AERODROME_VOTER, address(executor));
        executor.registerAdapter(AERODROME_ID, address(adapter));

        vm.deal(user, 10 ether);
    }

    function test_SwapETHForUSDC() public {
        uint256 amountIn = 0.01 ether;

        bytes memory swapData = abi.encode(
            address(0), // ETH as tokenIn
            USDC_BASE,
            amountIn,
            uint256(0), // no min
            user,
            false // volatile pool
        );
        PanoramaExecutor.Transfer[] memory transfers = new PanoramaExecutor.Transfer[](0);

        vm.startPrank(user);
        bytes memory result = executor.execute{value: amountIn}(
            AERODROME_ID, SWAP_SELECTOR, transfers, block.timestamp + 300, swapData
        );
        vm.stopPrank();

        uint256 amountOut = abi.decode(result, (uint256));
        assertGt(amountOut, 0, "Should receive USDC");
    }

    function test_GetQuote() public view {
        IAerodromeRouter router = IAerodromeRouter(AERODROME_ROUTER);
        address factory = router.defaultFactory();

        IAerodromeRouter.Route[] memory routes = new IAerodromeRouter.Route[](1);
        routes[0] = IAerodromeRouter.Route({from: WETH_BASE, to: USDC_BASE, stable: false, factory: factory});

        uint256[] memory amounts = router.getAmountsOut(0.01 ether, routes);
        assertGt(amounts[1], 0, "Should get a quote");
    }
}
