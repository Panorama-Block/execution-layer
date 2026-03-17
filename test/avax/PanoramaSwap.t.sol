// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import {PanoramaSwap} from "../../contracts/avax/core/PanoramaSwap.sol";
import {MockTraderJoeRouter} from "./mocks/MockTraderJoeRouter.sol";
import {MockERC20} from "../mocks/MockERC20.sol";

contract PanoramaSwapTest is Test {
    event SwapExecuted(
        address indexed user,
        address indexed tokenIn,
        address indexed tokenOut,
        uint256 amountIn,
        uint256 amountOut
    );
    PanoramaSwap public swap;
    MockTraderJoeRouter public router;

    MockERC20 public wavax;
    MockERC20 public usdc;
    MockERC20 public usdt;

    address public owner = address(this);
    address public user = address(0xA11CE);

    // All mock tokens use 18 decimals so amounts are consistent
    uint256 constant AMOUNT = 100e18;
    uint256 constant DEADLINE = type(uint256).max;

    receive() external payable {}

    function setUp() public {
        // Deploy mock tokens (18 decimals for consistent math in mock router)
        wavax = new MockERC20("Wrapped AVAX", "WAVAX", 18);
        usdc = new MockERC20("USD Coin", "USDC", 18);
        usdt = new MockERC20("Tether USD", "USDT", 18);

        // Deploy mock router using wavax as WAVAX
        router = new MockTraderJoeRouter(address(wavax));

        // Fund router generously so 1:1 mock swaps never underflow
        usdc.mint(address(router), 1_000_000e18);
        usdt.mint(address(router), 1_000_000e18);
        vm.deal(address(router), 1_000 ether);

        // Deploy PanoramaSwap
        swap = new PanoramaSwap(address(router));

        // Fund user
        usdc.mint(user, AMOUNT);
        usdt.mint(user, AMOUNT);
        vm.deal(user, 100 ether);
    }

    // ─── swapTokensForTokens ──────────────────────────────────────────────

    function test_SwapTokensForTokens_Success() public {
        address[] memory path = new address[](2);
        path[0] = address(usdc);
        path[1] = address(usdt);

        vm.startPrank(user);
        usdc.approve(address(swap), AMOUNT);
        uint256 amountOut = swap.swapTokensForTokens(AMOUNT, 0, path, DEADLINE);
        vm.stopPrank();

        assertEq(amountOut, AMOUNT);
        assertEq(usdt.balanceOf(user), AMOUNT * 2); // started with AMOUNT, received AMOUNT
        assertEq(usdc.balanceOf(user), 0);
    }

    function test_SwapTokensForTokens_EmitsEvent() public {
        address[] memory path = new address[](2);
        path[0] = address(usdc);
        path[1] = address(usdt);

        vm.startPrank(user);
        usdc.approve(address(swap), AMOUNT);

        vm.expectEmit(true, true, true, true);
        emit SwapExecuted(user, address(usdc), address(usdt), AMOUNT, AMOUNT);
        swap.swapTokensForTokens(AMOUNT, 0, path, DEADLINE);
        vm.stopPrank();
    }

    function test_SwapTokensForTokens_RevertIf_InvalidPath() public {
        address[] memory path = new address[](1);
        path[0] = address(usdc);

        vm.startPrank(user);
        usdc.approve(address(swap), AMOUNT);
        vm.expectRevert(PanoramaSwap.InvalidPath.selector);
        swap.swapTokensForTokens(AMOUNT, 0, path, DEADLINE);
        vm.stopPrank();
    }

    function test_SwapTokensForTokens_RevertIf_ZeroAmount() public {
        address[] memory path = new address[](2);
        path[0] = address(usdc);
        path[1] = address(usdt);

        vm.startPrank(user);
        vm.expectRevert(PanoramaSwap.ZeroAmount.selector);
        swap.swapTokensForTokens(0, 0, path, DEADLINE);
        vm.stopPrank();
    }

    function test_SwapTokensForTokens_RevertIf_DeadlineExpired() public {
        address[] memory path = new address[](2);
        path[0] = address(usdc);
        path[1] = address(usdt);

        vm.startPrank(user);
        usdc.approve(address(swap), AMOUNT);
        vm.expectRevert(PanoramaSwap.DeadlineExpired.selector);
        swap.swapTokensForTokens(AMOUNT, 0, path, block.timestamp - 1);
        vm.stopPrank();
    }

    // ─── swapAVAXForTokens ────────────────────────────────────────────────

    function test_SwapAVAXForTokens_Success() public {
        address[] memory path = new address[](2);
        path[0] = address(wavax);
        path[1] = address(usdc);

        uint256 avaxIn = 1 ether; // mock sends 1e18 usdc (18-dec mock token)
        uint256 usdcBefore = usdc.balanceOf(user);

        vm.prank(user);
        uint256 amountOut = swap.swapAVAXForTokens{value: avaxIn}(0, path, DEADLINE);

        assertEq(amountOut, avaxIn);
        assertEq(usdc.balanceOf(user), usdcBefore + avaxIn);
    }

    function test_SwapAVAXForTokens_EmitsEvent() public {
        address[] memory path = new address[](2);
        path[0] = address(wavax);
        path[1] = address(usdc);

        vm.startPrank(user);
        vm.expectEmit(true, true, true, true);
        emit SwapExecuted(user, address(wavax), address(usdc), 1 ether, 1 ether);
        swap.swapAVAXForTokens{value: 1 ether}(0, path, DEADLINE);
        vm.stopPrank();
    }

    function test_SwapAVAXForTokens_RevertIf_PathNotStartWithWAVAX() public {
        address[] memory path = new address[](2);
        path[0] = address(usdc); // wrong — should be WAVAX
        path[1] = address(usdt);

        vm.prank(user);
        vm.expectRevert(PanoramaSwap.InvalidPath.selector);
        swap.swapAVAXForTokens{value: 1 ether}(0, path, DEADLINE);
    }

    function test_SwapAVAXForTokens_RevertIf_ZeroValue() public {
        address[] memory path = new address[](2);
        path[0] = address(wavax);
        path[1] = address(usdc);

        vm.prank(user);
        vm.expectRevert(PanoramaSwap.ZeroAmount.selector);
        swap.swapAVAXForTokens{value: 0}(0, path, DEADLINE);
    }

    function test_SwapAVAXForTokens_RevertIf_DeadlineExpired() public {
        address[] memory path = new address[](2);
        path[0] = address(wavax);
        path[1] = address(usdc);

        vm.prank(user);
        vm.expectRevert(PanoramaSwap.DeadlineExpired.selector);
        swap.swapAVAXForTokens{value: 1 ether}(0, path, block.timestamp - 1);
    }

    // ─── swapTokensForAVAX ────────────────────────────────────────────────

    function test_SwapTokensForAVAX_Success() public {
        address[] memory path = new address[](2);
        path[0] = address(usdc);
        path[1] = address(wavax);

        uint256 avaxBefore = user.balance;

        vm.startPrank(user);
        usdc.approve(address(swap), AMOUNT);
        uint256 amountOut = swap.swapTokensForAVAX(AMOUNT, 0, path, DEADLINE);
        vm.stopPrank();

        assertEq(amountOut, AMOUNT);
        assertEq(user.balance, avaxBefore + AMOUNT);
        assertEq(usdc.balanceOf(user), 0);
    }

    function test_SwapTokensForAVAX_EmitsEvent() public {
        address[] memory path = new address[](2);
        path[0] = address(usdc);
        path[1] = address(wavax);

        vm.startPrank(user);
        usdc.approve(address(swap), AMOUNT);

        vm.expectEmit(true, true, true, true);
        emit SwapExecuted(user, address(usdc), address(wavax), AMOUNT, AMOUNT);
        swap.swapTokensForAVAX(AMOUNT, 0, path, DEADLINE);
        vm.stopPrank();
    }

    function test_SwapTokensForAVAX_RevertIf_PathNotEndWithWAVAX() public {
        address[] memory path = new address[](2);
        path[0] = address(usdc);
        path[1] = address(usdt); // wrong — should be WAVAX

        vm.startPrank(user);
        usdc.approve(address(swap), AMOUNT);
        vm.expectRevert(PanoramaSwap.InvalidPath.selector);
        swap.swapTokensForAVAX(AMOUNT, 0, path, DEADLINE);
        vm.stopPrank();
    }

    function test_SwapTokensForAVAX_RevertIf_ZeroAmount() public {
        address[] memory path = new address[](2);
        path[0] = address(usdc);
        path[1] = address(wavax);

        vm.prank(user);
        vm.expectRevert(PanoramaSwap.ZeroAmount.selector);
        swap.swapTokensForAVAX(0, 0, path, DEADLINE);
    }

    // ─── getAmountsOut ────────────────────────────────────────────────────

    function test_GetAmountsOut() public view {
        address[] memory path = new address[](2);
        path[0] = address(usdc);
        path[1] = address(usdt);

        uint256[] memory amounts = swap.getAmountsOut(AMOUNT, path);
        assertEq(amounts.length, 2);
        assertEq(amounts[0], AMOUNT);
        assertEq(amounts[1], AMOUNT);
    }

    // ─── Immutables ───────────────────────────────────────────────────────

    function test_RouterAndWAVAXSet() public view {
        assertEq(address(swap.router()), address(router));
        assertEq(swap.WAVAX(), address(wavax));
    }

    function test_OwnerIsDeployer() public view {
        assertEq(swap.owner(), owner);
    }
}
