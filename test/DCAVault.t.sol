// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import {PanoramaExecutor} from "../contracts/core/PanoramaExecutor.sol";
import {AerodromeAdapter} from "../contracts/adapters/AerodromeAdapter.sol";
import {DCAVault} from "../contracts/core/DCAVault.sol";
import {MockERC20} from "./mocks/MockERC20.sol";
import {MockRouter} from "./mocks/MockRouter.sol";

contract DCAVaultTest is Test {
    PanoramaExecutor public executor;
    AerodromeAdapter public adapter;
    DCAVault public vault;
    MockRouter public mockRouter;
    MockERC20 public tokenIn;
    MockERC20 public tokenOut;
    MockERC20 public weth;

    address public owner = address(this);
    address public keeper = address(0xCAFE);
    address public user = address(0xBEEF);

    bytes32 public constant AERODROME_ID = keccak256("aerodrome");

    function setUp() public {
        tokenIn = new MockERC20("Token In", "TIN", 18);
        tokenOut = new MockERC20("Token Out", "TOUT", 6);
        weth = new MockERC20("Wrapped ETH", "WETH", 18);
        mockRouter = new MockRouter(address(weth), address(0xFACE));

        executor = new PanoramaExecutor();
        adapter = new AerodromeAdapter(address(mockRouter), address(0xDEAD), address(executor));
        executor.registerAdapter(AERODROME_ID, address(adapter));

        vault = new DCAVault(keeper, address(executor));
        executor.setAuthorizedOperator(address(vault), true);
        vm.warp(block.timestamp + executor.ADMIN_DELAY());
        executor.executeAuthorizedOperatorChange(address(vault));

        tokenIn.mint(user, 1000e18);
    }

    function test_Execute_UsesUserAdapterAndPaysUser() public {
        uint256 depositAmount = 100e18;
        uint256 swapAmount = 25e18;

        vm.startPrank(user);
        tokenIn.approve(address(vault), depositAmount);
        uint256 orderId = vault.createOrder(address(tokenIn), address(tokenOut), swapAmount, 1 hours, 4, false, depositAmount);
        vm.stopPrank();

        assertEq(orderId, 0);
        assertEq(tokenOut.balanceOf(user), 0);
        assertEq(executor.getUserAdapter(AERODROME_ID, user), address(0));
        assertEq(executor.getUserAdapter(AERODROME_ID, address(vault)), address(0));

        vm.warp(block.timestamp + 1 hours);
        vm.prank(keeper);
        vault.execute(orderId, 0, abi.encode(false), block.timestamp + 1 hours);

        address userAdapter = executor.getUserAdapter(AERODROME_ID, user);
        assertTrue(userAdapter != address(0), "user adapter should be created");
        assertEq(executor.getUserAdapter(AERODROME_ID, address(vault)), address(0), "vault must not get its own adapter");
        assertEq(tokenOut.balanceOf(user), swapAmount, "swap output should go to the order owner");

        (, , , , , uint256 lastExecuted, uint256 remainingSwaps, uint256 balance, , bool active) = vault.orders(orderId);
        assertGt(lastExecuted, 0, "order should be marked executed");
        assertEq(remainingSwaps, 3, "remaining swaps should decrease");
        assertEq(balance, depositAmount - swapAmount, "vault balance should decrease by one swap");
        assertTrue(active, "order should remain active");
    }
}
