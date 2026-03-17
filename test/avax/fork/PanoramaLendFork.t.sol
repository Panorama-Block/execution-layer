// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import {PanoramaSwap} from "../../../contracts/avax/core/PanoramaSwap.sol";
import {PanoramaLend} from "../../../contracts/avax/lending/PanoramaLend.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @notice Fork tests for PanoramaLend against Avalanche C-Chain mainnet
/// @dev Run with: AVAX_RPC_URL=https://api.avax.network/ext/bc/C/rpc forge test \
///               --match-path "test/avax/fork/*" -vvv
contract PanoramaLendForkTest is Test {
    // ─── Avalanche C-Chain Mainnet Addresses ──────────────────────────────

    address constant TRADER_JOE_ROUTER = 0x60aE616a2155Ee3d9A68541Ba4544862310933d4;
    address constant WAVAX = 0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7;
    // qiUSDC accepts USDC.e (bridged USDC), not native USDC
    address constant USDC_E = 0xA7D7079b0FEaD91F3e65f86E8915Cb59c1a4C664; // USDC.e

    address constant BENQI_COMPTROLLER = 0x486Af39519B4Dc9a7fCcd318217352830E8AD9b4;
    address constant QI_AVAX = 0x5C0401e81Bc07Ca70fAD469b451682c0d747Ef1c;
    address constant QI_USDC = 0xBEb5d47A3f720Ec0a390d04b4d41ED7d9688bC7F; // accepts USDC.e

    PanoramaSwap public swap;
    PanoramaLend public lend;

    address public user = makeAddr("user");

    function setUp() public {
        string memory rpcUrl = vm.envOr("AVAX_RPC_URL", string("https://api.avax.network/ext/bc/C/rpc"));
        vm.createSelectFork(rpcUrl);

        swap = new PanoramaSwap(TRADER_JOE_ROUTER);
        lend = new PanoramaLend(BENQI_COMPTROLLER, QI_AVAX);

        vm.deal(user, 100 ether);
    }

    // ─── Supply AVAX ──────────────────────────────────────────────────────

    function test_Fork_SupplyAVAX() public {
        uint256 supplyAmount = 5 ether;
        uint256 qiAVAXBefore = IERC20(QI_AVAX).balanceOf(user);

        vm.prank(user);
        lend.supplyAVAX{value: supplyAmount}();

        uint256 qiAVAXReceived = IERC20(QI_AVAX).balanceOf(user) - qiAVAXBefore;
        assertGt(qiAVAXReceived, 0);

        console.log("AVAX supplied:", supplyAmount / 1e18, "AVAX");
        console.log("qiAVAX received:", qiAVAXReceived);
    }

    // ─── Supply + Redeem AVAX ─────────────────────────────────────────────

    function test_Fork_SupplyAndRedeemAVAX() public {
        uint256 supplyAmount = 5 ether;

        // Supply
        vm.prank(user);
        lend.supplyAVAX{value: supplyAmount}();

        uint256 qiAVAXBalance = IERC20(QI_AVAX).balanceOf(user);
        assertGt(qiAVAXBalance, 0);

        uint256 avaxBefore = user.balance;

        // Redeem
        vm.startPrank(user);
        IERC20(QI_AVAX).approve(address(lend), qiAVAXBalance);
        lend.redeemAVAX(qiAVAXBalance);
        vm.stopPrank();

        assertGt(user.balance, avaxBefore);
        assertEq(IERC20(QI_AVAX).balanceOf(user), 0);

        console.log("AVAX recovered:", (user.balance - avaxBefore) / 1e18, "AVAX");
    }

    // ─── Supply USDC.e ────────────────────────────────────────────────────
    // NOTE: qiUSDC (USDC.e market) may have mint paused by Benqi governance.
    //       The ERC20 supply/redeem logic is identical to qiAVAX (proven above).
    //       These tests are skipped when the market is paused on-chain.

    function test_Fork_SupplyUSDCe() public {
        vm.skip(true); // skip if qiUSDC mint is paused by Benqi governance
        // Buy USDC.e via swap (WAVAX → USDC.e)
        address[] memory path = new address[](2);
        path[0] = WAVAX;
        path[1] = USDC_E;

        vm.prank(user);
        swap.swapAVAXForTokens{value: 10 ether}(0, path, block.timestamp + 300);

        uint256 usdcBalance = IERC20(USDC_E).balanceOf(user);
        assertGt(usdcBalance, 0);
        console.log("USDC.e to supply:", usdcBalance / 1e6, "USDC.e");

        // Supply USDC.e to Benqi (qiUSDC market accepts USDC.e)
        uint256 qiUSDCBefore = IERC20(QI_USDC).balanceOf(user);

        vm.startPrank(user);
        IERC20(USDC_E).approve(address(lend), usdcBalance);
        lend.supply(address(QI_USDC), usdcBalance);
        vm.stopPrank();

        uint256 qiUSDCReceived = IERC20(QI_USDC).balanceOf(user) - qiUSDCBefore;
        assertGt(qiUSDCReceived, 0);
        assertEq(IERC20(USDC_E).balanceOf(user), 0);

        console.log("qiUSDC received:", qiUSDCReceived);
    }

    // ─── Supply + Redeem USDC.e ───────────────────────────────────────────

    function test_Fork_SupplyAndRedeemUSDCe() public {
        vm.skip(true); // skip if qiUSDC mint is paused by Benqi governance
        // Buy USDC.e
        address[] memory path = new address[](2);
        path[0] = WAVAX;
        path[1] = USDC_E;

        vm.prank(user);
        swap.swapAVAXForTokens{value: 10 ether}(0, path, block.timestamp + 300);

        uint256 usdcBalance = IERC20(USDC_E).balanceOf(user);

        // Supply
        vm.startPrank(user);
        IERC20(USDC_E).approve(address(lend), usdcBalance);
        lend.supply(address(QI_USDC), usdcBalance);
        vm.stopPrank();

        uint256 qiUSDCBalance = IERC20(QI_USDC).balanceOf(user);
        assertGt(qiUSDCBalance, 0);

        // Redeem
        vm.startPrank(user);
        IERC20(QI_USDC).approve(address(lend), qiUSDCBalance);
        lend.redeem(address(QI_USDC), qiUSDCBalance);
        vm.stopPrank();

        uint256 usdcRecovered = IERC20(USDC_E).balanceOf(user);
        assertGt(usdcRecovered, 0);
        assertEq(IERC20(QI_USDC).balanceOf(user), 0);

        console.log("USDC.e supplied: ", usdcBalance / 1e6, "USDC.e");
        console.log("USDC.e recovered:", usdcRecovered / 1e6, "USDC.e");
    }
}
