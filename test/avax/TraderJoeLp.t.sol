// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import {TraderJoeAdapterV2} from "../../contracts/avax/adapters/TraderJoeAdapterV2.sol";
import {MockTraderJoeRouter} from "./mocks/MockTraderJoeRouter.sol";
import {MockMasterChef} from "./mocks/MockMasterChef.sol";
import {MockERC20} from "../mocks/MockERC20.sol";

/// @notice Unit tests for TraderJoeAdapterV2 LP and Farm operations.
///         The test contract acts as the executor (msg.sender for onlyExecutor).
contract TraderJoeLpTest is Test {
    TraderJoeAdapterV2   public adapter;
    MockTraderJoeRouter  public router;
    MockMasterChef       public masterChef;

    MockERC20 public wavax;
    MockERC20 public usdc;
    MockERC20 public joe;
    MockERC20 public lpToken;

    address public executor = address(this); // test contract IS the executor
    address public user     = address(0xBEEF);

    uint256 constant AMOUNT    = 100e18;
    uint256 constant LP_AMOUNT = 50e18;
    uint256 constant PID       = 0;

    receive() external payable {}

    function setUp() public {
        wavax   = new MockERC20("Wrapped AVAX", "WAVAX", 18);
        usdc    = new MockERC20("USD Coin",     "USDC",  6);
        joe     = new MockERC20("JOE Token",    "JOE",   18);
        lpToken = new MockERC20("TJ-LP WAVAX/USDC", "TJ-LP", 18);

        router     = new MockTraderJoeRouter(address(wavax));
        masterChef = new MockMasterChef(address(joe));

        // Register LP pair in mock router
        router.registerPair(address(wavax), address(usdc), address(lpToken));

        // Pre-fund mock router for LP operations
        wavax.mint(address(router), 1_000_000e18);
        usdc.mint(address(router),  1_000_000e18);
        vm.deal(address(router),    1_000 ether);

        // Deploy and initialize adapter (executor = this test contract)
        adapter = new TraderJoeAdapterV2();
        adapter.initializeFull(executor, abi.encode(address(router)));
        adapter.initializeV2(address(masterChef), address(joe));

        // Fund adapter with initial tokens (executor pulls from user, then calls adapter)
        wavax.mint(address(adapter), AMOUNT);
        usdc.mint(address(adapter),  AMOUNT);
        vm.deal(address(adapter),    100 ether);
    }

    // ══════════════════════════════════════════════════════════════════════════
    //  INITIALIZER
    // ══════════════════════════════════════════════════════════════════════════

    function test_Init_StorageLayout() public view {
        assertEq(address(adapter.router()),     address(router));
        assertEq(adapter.wavax(),               address(wavax));
        assertEq(adapter.executor(),            executor);
        assertEq(address(adapter.masterChef()), address(masterChef));
        assertEq(adapter.joeToken(),            address(joe));
    }

    // ══════════════════════════════════════════════════════════════════════════
    //  onlyExecutor guard
    // ══════════════════════════════════════════════════════════════════════════

    function test_Revert_AddLiquidity_NotExecutor() public {
        vm.prank(user);
        vm.expectRevert(TraderJoeAdapterV2.OnlyExecutor.selector);
        adapter.addLiquidity(address(wavax), address(usdc), AMOUNT, AMOUNT, 0, 0, user);
    }

    function test_Revert_RemoveLiquidity_NotExecutor() public {
        vm.prank(user);
        vm.expectRevert(TraderJoeAdapterV2.OnlyExecutor.selector);
        adapter.removeLiquidity(address(wavax), address(usdc), address(lpToken), LP_AMOUNT, 0, 0, user);
    }

    function test_Revert_Stake_NotExecutor() public {
        vm.prank(user);
        vm.expectRevert(TraderJoeAdapterV2.OnlyExecutor.selector);
        adapter.stake(PID, LP_AMOUNT, address(lpToken), user);
    }

    function test_Revert_Unstake_NotExecutor() public {
        vm.prank(user);
        vm.expectRevert(TraderJoeAdapterV2.OnlyExecutor.selector);
        adapter.unstake(PID, LP_AMOUNT, address(lpToken), user);
    }

    function test_Revert_ClaimRewards_NotExecutor() public {
        vm.prank(user);
        vm.expectRevert(TraderJoeAdapterV2.OnlyExecutor.selector);
        adapter.claimRewards(PID, user);
    }

    // ══════════════════════════════════════════════════════════════════════════
    //  ZeroAmount / ZeroLiquidity guards
    // ══════════════════════════════════════════════════════════════════════════

    function test_Revert_AddLiquidity_ZeroAmountA() public {
        vm.expectRevert(TraderJoeAdapterV2.ZeroAmount.selector);
        adapter.addLiquidity(address(wavax), address(usdc), 0, AMOUNT, 0, 0, user);
    }

    function test_Revert_AddLiquidity_ZeroAmountB() public {
        vm.expectRevert(TraderJoeAdapterV2.ZeroAmount.selector);
        adapter.addLiquidity(address(wavax), address(usdc), AMOUNT, 0, 0, 0, user);
    }

    function test_Revert_RemoveLiquidity_ZeroLiquidity() public {
        vm.expectRevert(TraderJoeAdapterV2.ZeroLiquidity.selector);
        adapter.removeLiquidity(address(wavax), address(usdc), address(lpToken), 0, 0, 0, user);
    }

    function test_Revert_Stake_ZeroAmount() public {
        vm.expectRevert(TraderJoeAdapterV2.ZeroAmount.selector);
        adapter.stake(PID, 0, address(lpToken), user);
    }

    // ══════════════════════════════════════════════════════════════════════════
    //  ADD LIQUIDITY — Token-Token
    // ══════════════════════════════════════════════════════════════════════════

    function test_AddLiquidity_MintsLpToRecipient() public {
        uint256 lpBefore = lpToken.balanceOf(user);

        adapter.addLiquidity(address(wavax), address(usdc), AMOUNT, AMOUNT, 0, 0, user);

        assertGt(lpToken.balanceOf(user), lpBefore, "user should receive LP tokens");
    }

    function test_AddLiquidity_ApprovesRouterAndSpends() public {
        uint256 wavaxBefore = wavax.balanceOf(address(adapter));
        uint256 usdcBefore  = usdc.balanceOf(address(adapter));

        adapter.addLiquidity(address(wavax), address(usdc), AMOUNT, AMOUNT, 0, 0, user);

        assertEq(wavax.balanceOf(address(adapter)), wavaxBefore - AMOUNT);
        assertEq(usdc.balanceOf(address(adapter)),  usdcBefore  - AMOUNT);
    }

    function test_AddLiquidity_ReturnsDust() public {
        // Mock returns exactly desired amounts, so dust = 0 in this test.
        // We verify adapter balance is fully consumed (no dust remaining).
        adapter.addLiquidity(address(wavax), address(usdc), AMOUNT, AMOUNT, 0, 0, user);
        assertEq(wavax.balanceOf(address(adapter)), 0);
        assertEq(usdc.balanceOf(address(adapter)),  0);
    }

    // ══════════════════════════════════════════════════════════════════════════
    //  ADD LIQUIDITY — Token-AVAX
    // ══════════════════════════════════════════════════════════════════════════

    function test_AddLiquidityAVAX_MintsLpToRecipient() public {
        uint256 lpBefore = lpToken.balanceOf(user);

        adapter.addLiquidityAVAX{value: 10 ether}(
            address(usdc), AMOUNT, 0, 0, user
        );

        assertGt(lpToken.balanceOf(user), lpBefore);
    }

    function test_Revert_AddLiquidityAVAX_ZeroValue() public {
        vm.expectRevert(TraderJoeAdapterV2.ZeroAmount.selector);
        adapter.addLiquidityAVAX{value: 0}(address(usdc), AMOUNT, 0, 0, user);
    }

    function test_Revert_AddLiquidityAVAX_ZeroToken() public {
        vm.expectRevert(TraderJoeAdapterV2.ZeroAmount.selector);
        adapter.addLiquidityAVAX{value: 10 ether}(address(usdc), 0, 0, 0, user);
    }

    // ══════════════════════════════════════════════════════════════════════════
    //  REMOVE LIQUIDITY — Token-Token
    // ══════════════════════════════════════════════════════════════════════════

    function test_RemoveLiquidity_ReturnsTokensToRecipient() public {
        // Setup: mint LP tokens to adapter first (simulating a prior addLiquidity)
        lpToken.mint(address(adapter), LP_AMOUNT);
        // Router also needs tokens to return
        wavax.mint(address(router), LP_AMOUNT);
        usdc.mint(address(router),  LP_AMOUNT);

        uint256 wavaxBefore = wavax.balanceOf(user);
        uint256 usdcBefore  = usdc.balanceOf(user);

        adapter.removeLiquidity(address(wavax), address(usdc), address(lpToken), LP_AMOUNT, 0, 0, user);

        assertGt(wavax.balanceOf(user), wavaxBefore, "user should receive tokenA");
        assertGt(usdc.balanceOf(user),  usdcBefore,  "user should receive tokenB");
    }

    function test_RemoveLiquidity_BurnsLpTokens() public {
        lpToken.mint(address(adapter), LP_AMOUNT);
        wavax.mint(address(router), LP_AMOUNT);
        usdc.mint(address(router),  LP_AMOUNT);

        uint256 supplyBefore = lpToken.totalSupply();
        adapter.removeLiquidity(address(wavax), address(usdc), address(lpToken), LP_AMOUNT, 0, 0, user);

        assertEq(lpToken.totalSupply(), supplyBefore - LP_AMOUNT);
    }

    // ══════════════════════════════════════════════════════════════════════════
    //  STAKE
    // ══════════════════════════════════════════════════════════════════════════

    function test_Stake_DepositsToMasterChef() public {
        lpToken.mint(address(adapter), LP_AMOUNT);

        adapter.stake(PID, LP_AMOUNT, address(lpToken), user);

        (uint256 deposited,) = masterChef.userInfo(PID, address(adapter));
        assertEq(deposited, LP_AMOUNT, "MasterChef should record the deposit");
    }

    function test_Stake_ForwardsAutoHarvestedJoe() public {
        lpToken.mint(address(adapter), LP_AMOUNT);

        uint256 joeBefore = joe.balanceOf(user);
        adapter.stake(PID, LP_AMOUNT, address(lpToken), user);

        assertGt(joe.balanceOf(user), joeBefore, "harvested JOE should be forwarded to user");
    }

    // ══════════════════════════════════════════════════════════════════════════
    //  UNSTAKE
    // ══════════════════════════════════════════════════════════════════════════

    function test_Unstake_ForwardsLpAndJoe() public {
        // First stake
        lpToken.mint(address(adapter), LP_AMOUNT);
        adapter.stake(PID, LP_AMOUNT, address(lpToken), user);

        // MasterChef holds LP tokens — re-mint to simulate withdraw return
        // (Mock MasterChef doesn't actually hold LP tokens, just tracks amounts)
        lpToken.mint(address(adapter), LP_AMOUNT); // simulates MasterChef returning LP
        uint256 lpBefore  = lpToken.balanceOf(user);
        uint256 joeBefore = joe.balanceOf(user);

        adapter.unstake(PID, LP_AMOUNT, address(lpToken), user);

        assertGt(lpToken.balanceOf(user), lpBefore,  "LP tokens should be returned to user");
        assertGt(joe.balanceOf(user),     joeBefore, "JOE rewards should be forwarded to user");
    }

    // ══════════════════════════════════════════════════════════════════════════
    //  CLAIM REWARDS
    // ══════════════════════════════════════════════════════════════════════════

    function test_ClaimRewards_ForwardsJoeToRecipient() public {
        uint256 joeBefore = joe.balanceOf(user);

        adapter.claimRewards(PID, user);

        assertGt(joe.balanceOf(user), joeBefore, "JOE rewards should be forwarded");
    }

    function test_ClaimRewards_DoesNotMoveLpTokens() public {
        // stake some LP first so there's a position
        lpToken.mint(address(adapter), LP_AMOUNT);
        adapter.stake(PID, LP_AMOUNT, address(lpToken), user);

        (uint256 depositedBefore,) = masterChef.userInfo(PID, address(adapter));

        adapter.claimRewards(PID, user);

        (uint256 depositedAfter,) = masterChef.userInfo(PID, address(adapter));
        assertEq(depositedAfter, depositedBefore, "LP position must not change on harvest");
    }

    // ══════════════════════════════════════════════════════════════════════════
    //  VIEW
    // ══════════════════════════════════════════════════════════════════════════

    function test_GetAmountsOut_ReturnsMockAmounts() public view {
        address[] memory path = new address[](2);
        path[0] = address(wavax);
        path[1] = address(usdc);

        uint256[] memory amounts = adapter.getAmountsOut(AMOUNT, path);
        assertEq(amounts[0], AMOUNT);
        assertEq(amounts[1], AMOUNT);
    }
}
