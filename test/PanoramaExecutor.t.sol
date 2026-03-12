// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import {PanoramaExecutor} from "../contracts/core/PanoramaExecutor.sol";
import {AerodromeAdapter} from "../contracts/adapters/AerodromeAdapter.sol";
import {AdapterSelectors} from "../contracts/libraries/AdapterSelectors.sol";
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
        assertEq(executor.adapterImplementations(AERODROME_ID), address(adapter));
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
        assertEq(executor.adapterImplementations(AERODROME_ID), address(0));
    }

    function test_TransferOwnership() public {
        executor.transferOwnership(user);
        assertEq(executor.owner(), user);
    }

    function test_TransferOwnership_ZeroAddress() public {
        vm.expectRevert(PanoramaExecutor.ZeroAddress.selector);
        executor.transferOwnership(address(0));
    }

    function test_ClearUserAdapter() public {
        // First create a user adapter by executing
        uint256 amountIn = 100e18;
        bytes memory adapterData = abi.encode(address(tokenA), address(tokenB), amountIn, 0, user, false);
        PanoramaExecutor.TokenTransfer[] memory transfers = new PanoramaExecutor.TokenTransfer[](1);
        transfers[0] = PanoramaExecutor.TokenTransfer({ token: address(tokenA), amount: amountIn });

        vm.startPrank(user);
        tokenA.approve(address(executor), amountIn);
        executor.execute(AERODROME_ID, AdapterSelectors.SWAP, transfers, block.timestamp + 1, adapterData);
        vm.stopPrank();

        address userAdapter = executor.getUserAdapter(AERODROME_ID, user);
        assertNotEq(userAdapter, address(0));

        // Owner clears it
        executor.clearUserAdapter(AERODROME_ID, user);
        assertEq(executor.getUserAdapter(AERODROME_ID, user), address(0));
    }

    function test_ClearUserAdapter_OnlyOwner() public {
        vm.prank(user);
        vm.expectRevert(PanoramaExecutor.Unauthorized.selector);
        executor.clearUserAdapter(AERODROME_ID, user);
    }

    // ========== SWAP TESTS ==========

    function test_ExecuteSwap_ERC20() public {
        uint256 amountIn = 100e18;
        bytes memory adapterData = abi.encode(address(tokenA), address(tokenB), amountIn, 0, user, false);

        PanoramaExecutor.TokenTransfer[] memory transfers = new PanoramaExecutor.TokenTransfer[](1);
        transfers[0] = PanoramaExecutor.TokenTransfer({ token: address(tokenA), amount: amountIn });

        vm.startPrank(user);
        tokenA.approve(address(executor), amountIn);

        bytes memory result = executor.execute(
            AERODROME_ID, AdapterSelectors.SWAP, transfers, block.timestamp + 1, adapterData
        );
        vm.stopPrank();

        uint256 amountOut = abi.decode(result, (uint256));
        assertEq(amountOut, amountIn); // 1:1 mock rate
        assertEq(tokenB.balanceOf(user), 1000e18 + amountIn); // received output
    }

    function test_ExecuteSwap_ZeroAmount_Reverts() public {
        bytes memory adapterData = abi.encode(address(tokenA), address(tokenB), 0, 0, user, false);
        PanoramaExecutor.TokenTransfer[] memory transfers = new PanoramaExecutor.TokenTransfer[](0);

        vm.prank(user);
        vm.expectRevert(); // AerodromeAdapter.SwapFailed
        executor.execute(AERODROME_ID, AdapterSelectors.SWAP, transfers, block.timestamp + 1, adapterData);
    }

    function test_ExecuteSwap_DeadlineExpired() public {
        bytes memory adapterData = abi.encode(address(tokenA), address(tokenB), 1e18, 0, user, false);
        PanoramaExecutor.TokenTransfer[] memory transfers = new PanoramaExecutor.TokenTransfer[](0);

        vm.prank(user);
        vm.expectRevert(PanoramaExecutor.DeadlineExpired.selector);
        executor.execute(AERODROME_ID, AdapterSelectors.SWAP, transfers, block.timestamp - 1, adapterData);
    }

    function test_ExecuteSwap_AdapterNotRegistered() public {
        bytes memory adapterData = abi.encode(address(tokenA), address(tokenB), 1e18, 0, user, false);
        PanoramaExecutor.TokenTransfer[] memory transfers = new PanoramaExecutor.TokenTransfer[](0);

        vm.prank(user);
        vm.expectRevert(PanoramaExecutor.AdapterNotRegistered.selector);
        executor.execute(keccak256("unknown"), AdapterSelectors.SWAP, transfers, block.timestamp + 1, adapterData);
    }

    function test_ExecuteUnknownSelector_Reverts() public {
        bytes memory adapterData = abi.encode(address(tokenA));
        PanoramaExecutor.TokenTransfer[] memory transfers = new PanoramaExecutor.TokenTransfer[](0);

        vm.prank(user);
        vm.expectRevert(); // AerodromeAdapter.UnknownSelector
        executor.execute(AERODROME_ID, bytes4(keccak256("unknown")), transfers, block.timestamp + 1, adapterData);
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
