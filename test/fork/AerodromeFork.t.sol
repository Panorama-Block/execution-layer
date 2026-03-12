// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import {PanoramaExecutor} from "../../contracts/core/PanoramaExecutor.sol";
import {AerodromeAdapter} from "../../contracts/adapters/AerodromeAdapter.sol";
import {IERC20} from "../../contracts/interfaces/IERC20.sol";
import {IAerodromeGauge, IAerodromeVoter} from "../../contracts/interfaces/IAerodromeGauge.sol";

interface IAerodromeFactory {
    function getPool(address tokenA, address tokenB, bool stable) external view returns (address);
}

contract AerodromeForkTest is Test {
    // ========== CONTRACTS ==========

    PanoramaExecutor public executor;
    AerodromeAdapter public adapter;

    // ========== AERODROME ADDRESSES (BASE MAINNET) ==========

    address constant ROUTER = 0xcF77a3Ba9A5CA399B7c97c74d54e5b1Beb874E43;
    address constant VOTER = 0x16613524e02ad97eDfeF371bC883F2F5d6C480A5;
    address constant FACTORY = 0x420DD381b31aEf6683db6B902084cB0FFECe40Da;

    // ========== TOKEN ADDRESSES (BASE MAINNET) ==========

    address constant WETH = 0x4200000000000000000000000000000000000006;
    address constant USDC = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913;

    // ========== TEST STATE ==========

    address public user = address(0xBEEF);
    bytes32 public constant AERODROME_ID = keccak256("aerodrome");
    uint256 public deadline;

    // ========== SETUP ==========

    function setUp() public {
        vm.createSelectFork(vm.envString("BASE_RPC_URL"));

        // Deploy fresh contracts
        executor = new PanoramaExecutor();
        adapter = new AerodromeAdapter(ROUTER, VOTER, address(executor));
        executor.registerAdapter(AERODROME_ID, address(adapter));

        deadline = block.timestamp + 3600;
    }

    // ========== TEST 1: SWAP WETH -> USDC ==========

    function test_Fork_SwapWETHtoUSDC() public {
        uint256 amountIn = 0.01 ether;

        // Deal WETH to user
        deal(WETH, user, 1 ether);

        uint256 wethBefore = IERC20(WETH).balanceOf(user);

        vm.startPrank(user);
        IERC20(WETH).approve(address(executor), amountIn);

        executor.executeSwap(
            AERODROME_ID,
            WETH,
            USDC,
            amountIn,
            0,
            abi.encode(false), // volatile pool
            deadline
        );
        vm.stopPrank();

        uint256 wethAfter = IERC20(WETH).balanceOf(user);
        uint256 usdcBalance = IERC20(USDC).balanceOf(user);

        assertGt(usdcBalance, 0, "User should have received USDC");
        assertLt(wethAfter, wethBefore, "User WETH balance should have decreased");
        assertEq(wethBefore - wethAfter, amountIn, "WETH decrease should equal amountIn");
    }

    // ========== TEST 2: SWAP USDC -> WETH ==========

    function test_Fork_SwapUSDCtoWETH() public {
        uint256 amountIn = 100e6; // 100 USDC

        // Deal USDC to user
        deal(USDC, user, 10_000e6);

        vm.startPrank(user);
        IERC20(USDC).approve(address(executor), amountIn);

        executor.executeSwap(
            AERODROME_ID,
            USDC,
            WETH,
            amountIn,
            0,
            abi.encode(false), // volatile pool
            deadline
        );
        vm.stopPrank();

        uint256 wethBalance = IERC20(WETH).balanceOf(user);
        assertGt(wethBalance, 0, "User should have received WETH");
    }

    // ========== TEST 3: ADD LIQUIDITY ==========

    function test_Fork_AddLiquidity() public {
        uint256 amountWETH = 0.01 ether;
        uint256 amountUSDC = 10e6; // 10 USDC

        // Deal tokens to user
        deal(WETH, user, 0.1 ether);
        deal(USDC, user, 100e6);

        vm.startPrank(user);
        IERC20(WETH).approve(address(executor), amountWETH);
        IERC20(USDC).approve(address(executor), amountUSDC);

        executor.executeAddLiquidity(
            AERODROME_ID,
            WETH,
            USDC,
            false, // volatile pool
            amountWETH,
            amountUSDC,
            0,
            0,
            "0x",
            deadline
        );
        vm.stopPrank();

        // Get pool address and check LP balance
        address pool = IAerodromeFactory(FACTORY).getPool(WETH, USDC, false);
        assertTrue(pool != address(0), "Pool should exist");

        uint256 lpBalance = IERC20(pool).balanceOf(user);
        assertGt(lpBalance, 0, "User should have received LP tokens");
    }

    // ========== TEST 4: STAKE LP IN GAUGE ==========

    function test_Fork_StakeLPInGauge() public {
        // First add liquidity to get LP tokens
        uint256 amountWETH = 0.01 ether;
        uint256 amountUSDC = 10e6;

        deal(WETH, user, 0.1 ether);
        deal(USDC, user, 100e6);

        vm.startPrank(user);
        IERC20(WETH).approve(address(executor), amountWETH);
        IERC20(USDC).approve(address(executor), amountUSDC);

        executor.executeAddLiquidity(
            AERODROME_ID, WETH, USDC, false, amountWETH, amountUSDC, 0, 0, "0x", deadline
        );

        // Get pool and gauge
        address pool = IAerodromeFactory(FACTORY).getPool(WETH, USDC, false);
        address gauge = IAerodromeVoter(VOTER).gauges(pool);
        assertTrue(gauge != address(0), "Gauge should exist for WETH/USDC pool");

        uint256 lpBalance = IERC20(pool).balanceOf(user);
        assertGt(lpBalance, 0, "User should have LP tokens before staking");

        // Approve LP tokens to executor and stake
        IERC20(pool).approve(address(executor), lpBalance);

        executor.executeStake(AERODROME_ID, pool, lpBalance, abi.encode(gauge));
        vm.stopPrank();

        // The adapter calls gauge.deposit(amount) so balance is credited to the adapter.
        uint256 stakedBalance = IAerodromeGauge(gauge).balanceOf(address(adapter));
        assertGt(stakedBalance, 0, "Adapter should have staked LP in gauge");

        // User LP balance should be zero after staking
        uint256 userLpAfter = IERC20(pool).balanceOf(user);
        assertEq(userLpAfter, 0, "User should have no LP tokens after staking");
    }

    // ========== TEST 5: FULL FLOW ==========

    function test_Fork_FullFlow() public {
        uint256 amountWETH = 0.01 ether;
        uint256 amountUSDC = 10e6;

        // --- Step 1: Deal tokens ---
        deal(WETH, user, 1 ether);
        deal(USDC, user, 10_000e6);

        vm.startPrank(user);

        // --- Step 2: Add liquidity ---
        IERC20(WETH).approve(address(executor), amountWETH);
        IERC20(USDC).approve(address(executor), amountUSDC);

        executor.executeAddLiquidity(
            AERODROME_ID, WETH, USDC, false, amountWETH, amountUSDC, 0, 0, "0x", deadline
        );

        address pool = IAerodromeFactory(FACTORY).getPool(WETH, USDC, false);
        address gauge = IAerodromeVoter(VOTER).gauges(pool);

        uint256 lpBalance = IERC20(pool).balanceOf(user);
        assertGt(lpBalance, 0, "Full flow: user should have LP tokens after addLiquidity");

        // --- Step 3: Stake LP in gauge ---
        IERC20(pool).approve(address(executor), lpBalance);
        executor.executeStake(AERODROME_ID, pool, lpBalance, abi.encode(gauge));

        uint256 stakedBalance = IAerodromeGauge(gauge).balanceOf(address(adapter));
        assertGt(stakedBalance, 0, "Full flow: adapter should have staked balance in gauge");

        // --- Step 4: Unstake LP from gauge ---
        // The adapter withdraws from gauge, forwards LP to executor, executor forwards to user.
        executor.executeUnstake(AERODROME_ID, pool, stakedBalance, abi.encode(gauge));

        uint256 stakedAfterUnstake = IAerodromeGauge(gauge).balanceOf(address(adapter));
        assertEq(stakedAfterUnstake, 0, "Full flow: no staked balance after unstake");

        // LP tokens should be returned to the user (executeUnstake forwards them)
        uint256 userLpForRemoval = IERC20(pool).balanceOf(user);
        assertGt(userLpForRemoval, 0, "Full flow: user should have LP after unstake");

        uint256 wethBefore = IERC20(WETH).balanceOf(user);
        uint256 usdcBefore = IERC20(USDC).balanceOf(user);

        vm.startPrank(user);
        IERC20(pool).approve(address(executor), userLpForRemoval);

        executor.executeRemoveLiquidity(
            AERODROME_ID,
            WETH,
            USDC,
            false, // volatile
            userLpForRemoval,
            0,
            0,
            abi.encode(pool), // extraData = pool address
            deadline
        );
        vm.stopPrank();

        uint256 wethAfter = IERC20(WETH).balanceOf(user);
        uint256 usdcAfter = IERC20(USDC).balanceOf(user);

        assertGt(wethAfter, wethBefore, "Full flow: user should have received WETH from removeLiquidity");
        assertGt(usdcAfter, usdcBefore, "Full flow: user should have received USDC from removeLiquidity");
    }
}
