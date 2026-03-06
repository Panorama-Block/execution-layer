// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import {PanoramaExecutor} from "../contracts/core/PanoramaExecutor.sol";
import {AerodromeAdapter} from "../contracts/adapters/AerodromeAdapter.sol";
import {MockERC20} from "./mocks/MockERC20.sol";
import {MockRouter} from "./mocks/MockRouter.sol";

contract PanoramaExecutorTest is Test {
    receive() external payable {}
    PanoramaExecutor public executor;
    AerodromeAdapter public adapter;
    MockRouter public mockRouter;
    MockERC20 public tokenA;
    MockERC20 public tokenB;
    MockERC20 public weth;

    address public owner = address(this);
    address public user = address(0xBEEF);

    bytes32 public constant AERODROME_ID = keccak256("aerodrome");

    function setUp() public {
        // Deploy mock tokens
        tokenA = new MockERC20("Token A", "TKA", 18);
        tokenB = new MockERC20("Token B", "TKB", 18);
        weth = new MockERC20("Wrapped ETH", "WETH", 18);

        // Deploy mock router
        mockRouter = new MockRouter(address(weth), address(0xFACE));

        // Deploy executor
        executor = new PanoramaExecutor();

        // Deploy adapter with mock router and a mock voter
        adapter = new AerodromeAdapter(address(mockRouter), address(0xDEAD), address(executor));

        // Register adapter
        executor.registerAdapter(AERODROME_ID, address(adapter));

        // Fund user
        tokenA.mint(user, 1000e18);
        tokenB.mint(user, 1000e18);
        vm.deal(user, 100 ether);
    }

    // ========== ADMIN TESTS ==========

    function test_RegisterAdapter() public view {
        assertEq(executor.adapters(AERODROME_ID), address(adapter));
    }

    function test_RegisterAdapter_OnlyOwner() public {
        vm.prank(user);
        vm.expectRevert(PanoramaExecutor.Unauthorized.selector);
        executor.registerAdapter(keccak256("test"), address(0x1));
    }

    function test_RegisterAdapter_ZeroAddress() public {
        vm.expectRevert(PanoramaExecutor.ZeroAddress.selector);
        executor.registerAdapter(keccak256("test"), address(0));
    }

    function test_RemoveAdapter() public {
        executor.removeAdapter(AERODROME_ID);
        assertEq(executor.adapters(AERODROME_ID), address(0));
    }

    function test_TransferOwnership() public {
        executor.transferOwnership(user);
        assertEq(executor.owner(), user);
    }

    function test_TransferOwnership_ZeroAddress() public {
        vm.expectRevert(PanoramaExecutor.ZeroAddress.selector);
        executor.transferOwnership(address(0));
    }

    // ========== SWAP TESTS ==========

    function test_ExecuteSwap_ERC20() public {
        uint256 amountIn = 100e18;
        bytes memory extraData = abi.encode(false); // volatile pool

        vm.startPrank(user);
        tokenA.approve(address(executor), amountIn);

        uint256 amountOut = executor.executeSwap(
            AERODROME_ID, address(tokenA), address(tokenB), amountIn, 0, extraData, block.timestamp + 1
        );
        vm.stopPrank();

        assertEq(amountOut, amountIn); // 1:1 mock rate
        assertEq(tokenB.balanceOf(user), 1000e18 + amountIn); // received output
    }

    function test_ExecuteSwap_InvalidAmount() public {
        vm.prank(user);
        vm.expectRevert(PanoramaExecutor.InvalidAmount.selector);
        executor.executeSwap(AERODROME_ID, address(tokenA), address(tokenB), 0, 0, "", block.timestamp + 1);
    }

    function test_ExecuteSwap_DeadlineExpired() public {
        vm.prank(user);
        vm.expectRevert(PanoramaExecutor.DeadlineExpired.selector);
        executor.executeSwap(AERODROME_ID, address(tokenA), address(tokenB), 1e18, 0, "", block.timestamp - 1);
    }

    function test_ExecuteSwap_AdapterNotRegistered() public {
        vm.prank(user);
        vm.expectRevert(PanoramaExecutor.AdapterNotRegistered.selector);
        executor.executeSwap(keccak256("unknown"), address(tokenA), address(tokenB), 1e18, 0, "", block.timestamp + 1);
    }

    // ========== EMERGENCY TESTS ==========

    function test_EmergencyWithdraw() public {
        vm.deal(address(executor), 1 ether);
        uint256 balBefore = owner.balance;
        executor.emergencyWithdraw();
        assertEq(owner.balance, balBefore + 1 ether);
    }

    function test_EmergencyWithdrawERC20() public {
        tokenA.mint(address(executor), 500e18);
        executor.emergencyWithdrawERC20(address(tokenA));
        assertEq(tokenA.balanceOf(owner), 500e18);
    }

    function test_EmergencyWithdraw_OnlyOwner() public {
        vm.prank(user);
        vm.expectRevert(PanoramaExecutor.Unauthorized.selector);
        executor.emergencyWithdraw();
    }
}
