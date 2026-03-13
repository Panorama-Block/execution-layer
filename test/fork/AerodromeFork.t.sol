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

    // ========== SELECTORS ==========

    bytes4 public constant SWAP_SELECTOR =
        bytes4(keccak256("swap(address,address,uint256,uint256,address,bool)"));
    bytes4 public constant ADD_LIQUIDITY_SELECTOR =
        bytes4(keccak256("addLiquidity(address,address,bool,uint256,uint256,uint256,uint256,address)"));
    bytes4 public constant REMOVE_LIQUIDITY_SELECTOR =
        bytes4(keccak256("removeLiquidity(address,address,bool,uint256,uint256,uint256,address,address)"));
    bytes4 public constant STAKE_SELECTOR =
        bytes4(keccak256("stake(address,uint256,address)"));
    bytes4 public constant UNSTAKE_SELECTOR =
        bytes4(keccak256("unstake(address,uint256,address,address)"));

    // ========== TEST STATE ==========

    address public user = address(0xBEEF);
    bytes32 public constant AERODROME_ID = keccak256("aerodrome");
    uint256 public deadline;

    // ========== SETUP ==========

    function setUp() public {
        vm.createSelectFork(vm.envString("BASE_RPC_URL"));

        executor = new PanoramaExecutor();
        adapter = new AerodromeAdapter(ROUTER, VOTER, address(executor));
        executor.registerAdapter(AERODROME_ID, address(adapter));

        deadline = block.timestamp + 3600;
    }

    // ========== HELPERS ==========

    function _transfers(address token, uint256 amount)
        internal
        pure
        returns (PanoramaExecutor.Transfer[] memory t)
    {
        t = new PanoramaExecutor.Transfer[](1);
        t[0] = PanoramaExecutor.Transfer({token: token, amount: amount});
    }

    function _transfers2(address tokenA, uint256 amountA, address tokenB, uint256 amountB)
        internal
        pure
        returns (PanoramaExecutor.Transfer[] memory t)
    {
        t = new PanoramaExecutor.Transfer[](2);
        t[0] = PanoramaExecutor.Transfer({token: tokenA, amount: amountA});
        t[1] = PanoramaExecutor.Transfer({token: tokenB, amount: amountB});
    }

    // ========== TEST 1: SWAP WETH -> USDC ==========

    function test_Fork_SwapWETHtoUSDC() public {
        uint256 amountIn = 0.01 ether;

        deal(WETH, user, 1 ether);
        uint256 wethBefore = IERC20(WETH).balanceOf(user);

        vm.startPrank(user);
        IERC20(WETH).approve(address(executor), amountIn);

        bytes memory swapData = abi.encode(WETH, USDC, amountIn, uint256(0), user, false);
        executor.execute(AERODROME_ID, SWAP_SELECTOR, _transfers(WETH, amountIn), deadline, swapData);
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

        deal(USDC, user, 10_000e6);

        vm.startPrank(user);
        IERC20(USDC).approve(address(executor), amountIn);

        bytes memory swapData = abi.encode(USDC, WETH, amountIn, uint256(0), user, false);
        executor.execute(AERODROME_ID, SWAP_SELECTOR, _transfers(USDC, amountIn), deadline, swapData);
        vm.stopPrank();

        uint256 wethBalance = IERC20(WETH).balanceOf(user);
        assertGt(wethBalance, 0, "User should have received WETH");
    }

    // ========== TEST 3: ADD LIQUIDITY ==========

    function test_Fork_AddLiquidity() public {
        uint256 amountWETH = 0.01 ether;
        uint256 amountUSDC = 10e6;

        deal(WETH, user, 0.1 ether);
        deal(USDC, user, 100e6);

        vm.startPrank(user);
        IERC20(WETH).approve(address(executor), amountWETH);
        IERC20(USDC).approve(address(executor), amountUSDC);

        bytes memory addLiqData = abi.encode(WETH, USDC, false, amountWETH, amountUSDC, uint256(0), uint256(0), user);
        executor.execute(
            AERODROME_ID,
            ADD_LIQUIDITY_SELECTOR,
            _transfers2(WETH, amountWETH, USDC, amountUSDC),
            deadline,
            addLiqData
        );
        vm.stopPrank();

        address pool = IAerodromeFactory(FACTORY).getPool(WETH, USDC, false);
        assertTrue(pool != address(0), "Pool should exist");

        uint256 lpBalance = IERC20(pool).balanceOf(user);
        assertGt(lpBalance, 0, "User should have received LP tokens");
    }

    // ========== TEST 4: STAKE LP IN GAUGE ==========

    function test_Fork_StakeLPInGauge() public {
        uint256 amountWETH = 0.01 ether;
        uint256 amountUSDC = 10e6;

        deal(WETH, user, 0.1 ether);
        deal(USDC, user, 100e6);

        vm.startPrank(user);
        IERC20(WETH).approve(address(executor), amountWETH);
        IERC20(USDC).approve(address(executor), amountUSDC);

        bytes memory addLiqData = abi.encode(WETH, USDC, false, amountWETH, amountUSDC, uint256(0), uint256(0), user);
        executor.execute(
            AERODROME_ID,
            ADD_LIQUIDITY_SELECTOR,
            _transfers2(WETH, amountWETH, USDC, amountUSDC),
            deadline,
            addLiqData
        );

        address pool = IAerodromeFactory(FACTORY).getPool(WETH, USDC, false);
        address gauge = IAerodromeVoter(VOTER).gauges(pool);
        assertTrue(gauge != address(0), "Gauge should exist for WETH/USDC pool");

        uint256 lpBalance = IERC20(pool).balanceOf(user);
        assertGt(lpBalance, 0, "User should have LP tokens before staking");

        IERC20(pool).approve(address(executor), lpBalance);

        bytes memory stakeData = abi.encode(pool, lpBalance, gauge);
        executor.execute(AERODROME_ID, STAKE_SELECTOR, _transfers(pool, lpBalance), deadline, stakeData);
        vm.stopPrank();

        // Per-user adapter clone holds the staked position
        address userAdapter = executor.userAdapters(AERODROME_ID, user);
        uint256 stakedBalance = IAerodromeGauge(gauge).balanceOf(userAdapter);
        assertGt(stakedBalance, 0, "User adapter should have staked LP in gauge");

        uint256 userLpAfter = IERC20(pool).balanceOf(user);
        assertEq(userLpAfter, 0, "User should have no LP tokens after staking");
    }

    // ========== TEST 5: FULL FLOW ==========

    function test_Fork_FullFlow() public {
        uint256 amountWETH = 0.01 ether;
        uint256 amountUSDC = 10e6;

        deal(WETH, user, 1 ether);
        deal(USDC, user, 10_000e6);

        vm.startPrank(user);

        // --- Step 1: Add liquidity ---
        IERC20(WETH).approve(address(executor), amountWETH);
        IERC20(USDC).approve(address(executor), amountUSDC);

        bytes memory addLiqData = abi.encode(WETH, USDC, false, amountWETH, amountUSDC, uint256(0), uint256(0), user);
        executor.execute(
            AERODROME_ID,
            ADD_LIQUIDITY_SELECTOR,
            _transfers2(WETH, amountWETH, USDC, amountUSDC),
            deadline,
            addLiqData
        );

        address pool = IAerodromeFactory(FACTORY).getPool(WETH, USDC, false);
        address gauge = IAerodromeVoter(VOTER).gauges(pool);

        uint256 lpBalance = IERC20(pool).balanceOf(user);
        assertGt(lpBalance, 0, "Full flow: user should have LP tokens after addLiquidity");

        // --- Step 2: Stake LP in gauge ---
        IERC20(pool).approve(address(executor), lpBalance);
        bytes memory stakeData = abi.encode(pool, lpBalance, gauge);
        executor.execute(AERODROME_ID, STAKE_SELECTOR, _transfers(pool, lpBalance), deadline, stakeData);

        address userAdapter = executor.userAdapters(AERODROME_ID, user);
        uint256 stakedBalance = IAerodromeGauge(gauge).balanceOf(userAdapter);
        assertGt(stakedBalance, 0, "Full flow: adapter should have staked balance in gauge");

        // --- Step 3: Unstake LP from gauge ---
        bytes memory unstakeData = abi.encode(pool, stakedBalance, gauge, user);
        PanoramaExecutor.Transfer[] memory noTransfers = new PanoramaExecutor.Transfer[](0);
        executor.execute(AERODROME_ID, UNSTAKE_SELECTOR, noTransfers, deadline, unstakeData);

        uint256 stakedAfterUnstake = IAerodromeGauge(gauge).balanceOf(userAdapter);
        assertEq(stakedAfterUnstake, 0, "Full flow: no staked balance after unstake");

        uint256 userLpForRemoval = IERC20(pool).balanceOf(user);
        assertGt(userLpForRemoval, 0, "Full flow: user should have LP after unstake");

        // --- Step 4: Remove liquidity ---
        uint256 wethBefore = IERC20(WETH).balanceOf(user);
        uint256 usdcBefore = IERC20(USDC).balanceOf(user);

        IERC20(pool).approve(address(executor), userLpForRemoval);
        bytes memory removeLiqData = abi.encode(WETH, USDC, false, userLpForRemoval, uint256(0), uint256(0), user, pool);
        executor.execute(
            AERODROME_ID,
            REMOVE_LIQUIDITY_SELECTOR,
            _transfers(pool, userLpForRemoval),
            deadline,
            removeLiqData
        );
        vm.stopPrank();

        uint256 wethAfter = IERC20(WETH).balanceOf(user);
        uint256 usdcAfter = IERC20(USDC).balanceOf(user);

        assertGt(wethAfter, wethBefore, "Full flow: user should have received WETH from removeLiquidity");
        assertGt(usdcAfter, usdcBefore, "Full flow: user should have received USDC from removeLiquidity");
    }
}
