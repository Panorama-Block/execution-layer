// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import {PanoramaLiquidStaking} from "../../contracts/avax/liquid-staking/PanoramaLiquidStaking.sol";
import {IStakedAvax} from "../../contracts/avax/interfaces/IStakedAvax.sol";
import {MockStakedAvax} from "./mocks/MockStakedAvax.sol";

contract PanoramaLiquidStakingTest is Test {
    event Staked(address indexed user, uint256 avaxAmount, uint256 sAvaxReceived);
    event UnlockRequested(address indexed user, uint256 sAvaxAmount, uint256 userUnlockIndex);
    event Redeemed(address indexed user, uint256 userUnlockIndex, uint256 avaxReceived);

    PanoramaLiquidStaking public liquidStaking;
    MockStakedAvax public mockSAvax;

    address public owner = address(this);
    address public user  = address(0xB0B);
    address public user2 = address(0xA1B2);

    uint256 constant AVAX_AMOUNT = 10 ether;

    receive() external payable {}

    function setUp() public {
        mockSAvax = new MockStakedAvax();
        vm.deal(address(mockSAvax), 1_000 ether);

        liquidStaking = new PanoramaLiquidStaking(address(mockSAvax));

        vm.deal(user,  100 ether);
        vm.deal(user2, 100 ether);
    }

    // ─── stake ────────────────────────────────────────────────────────────

    function test_Stake_Success() public {
        vm.prank(user);
        uint256 received = liquidStaking.stake{value: AVAX_AMOUNT}();

        assertEq(received, AVAX_AMOUNT);
        assertEq(mockSAvax.balanceOf(user), AVAX_AMOUNT);
        assertEq(user.balance, 100 ether - AVAX_AMOUNT);
    }

    function test_Stake_EmitsEvent() public {
        vm.prank(user);
        vm.expectEmit(true, false, false, true);
        emit Staked(user, AVAX_AMOUNT, AVAX_AMOUNT);
        liquidStaking.stake{value: AVAX_AMOUNT}();
    }

    function test_Stake_RevertIf_ZeroValue() public {
        vm.prank(user);
        vm.expectRevert(PanoramaLiquidStaking.ZeroAmount.selector);
        liquidStaking.stake{value: 0}();
    }

    function test_Stake_MultipleUsers() public {
        vm.prank(user);
        liquidStaking.stake{value: 5 ether}();

        vm.prank(user2);
        liquidStaking.stake{value: 3 ether}();

        assertEq(mockSAvax.balanceOf(user),  5 ether);
        assertEq(mockSAvax.balanceOf(user2), 3 ether);
    }

    // ─── requestUnlock ────────────────────────────────────────────────────

    function test_RequestUnlock_Success() public {
        vm.prank(user);
        liquidStaking.stake{value: AVAX_AMOUNT}();

        vm.startPrank(user);
        mockSAvax.approve(address(liquidStaking), AVAX_AMOUNT);
        uint256 idx = liquidStaking.requestUnlock(AVAX_AMOUNT);
        vm.stopPrank();

        assertEq(idx, 0);
        assertEq(mockSAvax.balanceOf(user), 0);
        assertEq(liquidStaking.getUnlockRequestCount(user), 1);
    }

    function test_RequestUnlock_EmitsEvent() public {
        vm.prank(user);
        liquidStaking.stake{value: AVAX_AMOUNT}();

        vm.startPrank(user);
        mockSAvax.approve(address(liquidStaking), AVAX_AMOUNT);
        vm.expectEmit(true, false, false, true);
        emit UnlockRequested(user, AVAX_AMOUNT, 0);
        liquidStaking.requestUnlock(AVAX_AMOUNT);
        vm.stopPrank();
    }

    function test_RequestUnlock_RevertIf_ZeroAmount() public {
        vm.prank(user);
        vm.expectRevert(PanoramaLiquidStaking.ZeroAmount.selector);
        liquidStaking.requestUnlock(0);
    }

    function test_RequestUnlock_IndexIncrementsPerUser() public {
        vm.prank(user);
        liquidStaking.stake{value: AVAX_AMOUNT}();

        vm.startPrank(user);
        mockSAvax.approve(address(liquidStaking), AVAX_AMOUNT);
        uint256 idx0 = liquidStaking.requestUnlock(4 ether);
        uint256 idx1 = liquidStaking.requestUnlock(6 ether);
        vm.stopPrank();

        assertEq(idx0, 0);
        assertEq(idx1, 1);
        assertEq(liquidStaking.getUnlockRequestCount(user), 2);
    }

    function test_RequestUnlock_IsolatedPerUser() public {
        vm.prank(user);
        liquidStaking.stake{value: 5 ether}();
        vm.prank(user2);
        liquidStaking.stake{value: 3 ether}();

        vm.startPrank(user);
        mockSAvax.approve(address(liquidStaking), 5 ether);
        liquidStaking.requestUnlock(5 ether);
        vm.stopPrank();

        vm.startPrank(user2);
        mockSAvax.approve(address(liquidStaking), 3 ether);
        liquidStaking.requestUnlock(3 ether);
        vm.stopPrank();

        assertEq(liquidStaking.getUnlockRequestCount(user),  1);
        assertEq(liquidStaking.getUnlockRequestCount(user2), 1);
    }

    // ─── redeem ───────────────────────────────────────────────────────────

    function test_Redeem_Success() public {
        vm.prank(user);
        liquidStaking.stake{value: AVAX_AMOUNT}();

        vm.startPrank(user);
        mockSAvax.approve(address(liquidStaking), AVAX_AMOUNT);
        liquidStaking.requestUnlock(AVAX_AMOUNT);
        vm.stopPrank();

        uint256 balBefore = user.balance;

        vm.prank(user);
        liquidStaking.redeem(0);

        assertEq(user.balance, balBefore + AVAX_AMOUNT);
        assertEq(liquidStaking.getUnlockRequestCount(user), 0);
    }

    function test_Redeem_EmitsEvent() public {
        vm.prank(user);
        liquidStaking.stake{value: AVAX_AMOUNT}();

        vm.startPrank(user);
        mockSAvax.approve(address(liquidStaking), AVAX_AMOUNT);
        liquidStaking.requestUnlock(AVAX_AMOUNT);

        vm.expectEmit(true, false, false, true);
        emit Redeemed(user, 0, AVAX_AMOUNT);
        liquidStaking.redeem(0);
        vm.stopPrank();
    }

    function test_Redeem_RevertIf_InvalidIndex() public {
        vm.prank(user);
        vm.expectRevert(PanoramaLiquidStaking.InvalidUnlockIndex.selector);
        liquidStaking.redeem(0);
    }

    function test_Redeem_RevertIf_RedeemFails() public {
        vm.prank(user);
        liquidStaking.stake{value: AVAX_AMOUNT}();

        vm.startPrank(user);
        mockSAvax.approve(address(liquidStaking), AVAX_AMOUNT);
        liquidStaking.requestUnlock(AVAX_AMOUNT);
        vm.stopPrank();

        mockSAvax.setRedeemFails(true);

        vm.prank(user);
        vm.expectRevert("MockStakedAvax: redeem failed");
        liquidStaking.redeem(0);
    }

    function test_Redeem_CannotStealOtherUserUnlock() public {
        vm.prank(user);
        liquidStaking.stake{value: AVAX_AMOUNT}();

        vm.startPrank(user);
        mockSAvax.approve(address(liquidStaking), AVAX_AMOUNT);
        liquidStaking.requestUnlock(AVAX_AMOUNT);
        vm.stopPrank();

        // user2 has no unlock requests — must revert
        vm.prank(user2);
        vm.expectRevert(PanoramaLiquidStaking.InvalidUnlockIndex.selector);
        liquidStaking.redeem(0);
    }

    // ─── view helpers ─────────────────────────────────────────────────────

    function test_PreviewStake_InitiallyOneToOne() public view {
        assertEq(liquidStaking.previewStake(1 ether), 1 ether);
    }

    function test_PreviewRedeem_InitiallyOneToOne() public view {
        assertEq(liquidStaking.previewRedeem(1 ether), 1 ether);
    }

    function test_ExchangeRate_InitiallyOneToOne() public view {
        assertEq(liquidStaking.exchangeRate(), 1e18);
    }

    function test_ExchangeRate_AfterStake() public {
        vm.prank(user);
        liquidStaking.stake{value: AVAX_AMOUNT}();
        assertEq(liquidStaking.exchangeRate(), 1e18);
    }

    function test_GetUnlockRequest() public {
        vm.prank(user);
        liquidStaking.stake{value: AVAX_AMOUNT}();

        vm.startPrank(user);
        mockSAvax.approve(address(liquidStaking), AVAX_AMOUNT);
        liquidStaking.requestUnlock(AVAX_AMOUNT);
        vm.stopPrank();

        IStakedAvax.UnlockRequest memory req = liquidStaking.getUnlockRequest(user, 0);
        assertEq(req.shareAmount, AVAX_AMOUNT);
    }

    function test_GetUnlockRequest_RevertIf_InvalidIndex() public {
        vm.expectRevert(PanoramaLiquidStaking.InvalidUnlockIndex.selector);
        liquidStaking.getUnlockRequest(user, 0);
    }

    // ─── constructor / immutables ─────────────────────────────────────────

    function test_SAvaxIsSet() public view {
        assertEq(address(liquidStaking.sAvax()), address(mockSAvax));
    }

    function test_OwnerIsDeployer() public view {
        assertEq(liquidStaking.owner(), owner);
    }
}
