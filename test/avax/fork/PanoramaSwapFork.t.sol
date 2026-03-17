// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import {PanoramaSwap} from "../../../contracts/avax/core/PanoramaSwap.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @notice Fork tests against Avalanche C-Chain mainnet
/// @dev Run with: AVAX_RPC_URL=https://api.avax.network/ext/bc/C/rpc forge test \
///               --match-path "test/avax/fork/*" -vvv
contract PanoramaSwapForkTest is Test {
    // ─── Avalanche C-Chain Mainnet Addresses ──────────────────────────────

    address constant TRADER_JOE_ROUTER = 0x60aE616a2155Ee3d9A68541Ba4544862310933d4;
    address constant WAVAX = 0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7;
    address constant USDC = 0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E; // Native USDC (6 dec)
    address constant USDT = 0x9702230A8Ea53601f5cD2dc00fDBc13d4dF4A8c7; // Native USDT (6 dec)

    PanoramaSwap public swap;
    address public user = makeAddr("user");

    function setUp() public {
        string memory rpcUrl = vm.envOr("AVAX_RPC_URL", string("https://api.avax.network/ext/bc/C/rpc"));
        vm.createSelectFork(rpcUrl);

        swap = new PanoramaSwap(TRADER_JOE_ROUTER);
        vm.deal(user, 100 ether);
    }

    // ─── AVAX → USDC ──────────────────────────────────────────────────────

    function test_Fork_SwapAVAXForUSDC() public {
        address[] memory path = new address[](2);
        path[0] = WAVAX;
        path[1] = USDC;

        uint256 avaxIn = 1 ether;
        uint256 deadline = block.timestamp + 300;

        uint256[] memory expectedAmounts = swap.getAmountsOut(avaxIn, path);
        uint256 amountOutMin = expectedAmounts[1] * 95 / 100; // 5% slippage

        uint256 usdcBefore = IERC20(USDC).balanceOf(user);

        vm.prank(user);
        uint256 amountOut = swap.swapAVAXForTokens{value: avaxIn}(amountOutMin, path, deadline);

        assertGt(amountOut, 0);
        assertGe(amountOut, amountOutMin);
        assertEq(IERC20(USDC).balanceOf(user), usdcBefore + amountOut);

        console.log("AVAX in:   ", avaxIn / 1e18, "AVAX");
        console.log("USDC out:  ", amountOut / 1e6, "USDC");
    }

    // ─── USDC → AVAX ──────────────────────────────────────────────────────

    function test_Fork_SwapUSDCForAVAX() public {
        // Get USDC by swapping AVAX first
        address[] memory pathBuy = new address[](2);
        pathBuy[0] = WAVAX;
        pathBuy[1] = USDC;

        vm.prank(user);
        swap.swapAVAXForTokens{value: 5 ether}(0, pathBuy, block.timestamp + 300);

        uint256 usdcBalance = IERC20(USDC).balanceOf(user);
        assertGt(usdcBalance, 0);

        // Now swap USDC → AVAX
        address[] memory path = new address[](2);
        path[0] = USDC;
        path[1] = WAVAX;

        uint256 avaxBefore = user.balance;

        vm.startPrank(user);
        IERC20(USDC).approve(address(swap), usdcBalance);
        uint256 amountOut = swap.swapTokensForAVAX(usdcBalance, 0, path, block.timestamp + 300);
        vm.stopPrank();

        assertGt(amountOut, 0);
        assertGt(user.balance, avaxBefore);

        console.log("USDC in:   ", usdcBalance / 1e6, "USDC");
        console.log("AVAX out:  ", amountOut / 1e18, "AVAX");
    }

    // ─── USDC → USDT ──────────────────────────────────────────────────────

    function test_Fork_SwapUSDCForUSDT() public {
        // Get USDC
        address[] memory pathBuy = new address[](2);
        pathBuy[0] = WAVAX;
        pathBuy[1] = USDC;

        vm.prank(user);
        swap.swapAVAXForTokens{value: 5 ether}(0, pathBuy, block.timestamp + 300);

        uint256 usdcBalance = IERC20(USDC).balanceOf(user);

        // Swap USDC → USDT (via WAVAX)
        address[] memory path = new address[](3);
        path[0] = USDC;
        path[1] = WAVAX;
        path[2] = USDT;

        vm.startPrank(user);
        IERC20(USDC).approve(address(swap), usdcBalance);
        uint256 amountOut = swap.swapTokensForTokens(usdcBalance, 0, path, block.timestamp + 300);
        vm.stopPrank();

        assertGt(amountOut, 0);
        assertEq(IERC20(USDT).balanceOf(user), amountOut);

        console.log("USDC in:   ", usdcBalance / 1e6, "USDC");
        console.log("USDT out:  ", amountOut / 1e6, "USDT");
    }

    // ─── getAmountsOut ────────────────────────────────────────────────────

    function test_Fork_GetAmountsOut_AVAX_To_USDC() public view {
        address[] memory path = new address[](2);
        path[0] = WAVAX;
        path[1] = USDC;

        uint256[] memory amounts = swap.getAmountsOut(1 ether, path);

        assertEq(amounts.length, 2);
        assertEq(amounts[0], 1 ether);
        assertGt(amounts[1], 0);

        console.log("1 AVAX =", amounts[1] / 1e6, "USDC");
    }
}
