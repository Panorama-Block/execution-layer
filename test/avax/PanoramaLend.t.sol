// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import {PanoramaLend} from "../../contracts/avax/lending/PanoramaLend.sol";
import {MockBenqiToken, MockBenqiAVAX, MockComptroller} from "./mocks/MockBenqi.sol";
import {MockERC20} from "../mocks/MockERC20.sol";

contract PanoramaLendTest is Test {
    event Supplied(address indexed user, address indexed qToken, uint256 amount);
    event Redeemed(address indexed user, address indexed qToken, uint256 qTokenAmount);
    event Borrowed(address indexed user, address indexed qToken, uint256 amount);
    event Repaid(address indexed user, address indexed qToken, uint256 amount);

    PanoramaLend public lend;

    MockComptroller public comptroller;
    MockBenqiAVAX public qiAVAX;

    MockERC20 public usdc;
    MockBenqiToken public qiUSDC;

    address public owner = address(this);
    address public user = address(0xB0B);

    uint256 constant AMOUNT = 1_000e6; // 1000 USDC (6 decimals)
    uint256 constant AVAX_AMOUNT = 10 ether;

    receive() external payable {}

    function setUp() public {
        usdc = new MockERC20("USD Coin", "USDC", 6);

        comptroller = new MockComptroller();
        qiAVAX = new MockBenqiAVAX();
        qiUSDC = new MockBenqiToken("Benqi USDC", "qiUSDC", address(usdc));

        // Fund mock qTokens with reserves (for borrow/redeem)
        usdc.mint(address(qiUSDC), 1_000_000e6);
        vm.deal(address(qiAVAX), 1_000 ether);

        lend = new PanoramaLend(address(comptroller), address(qiAVAX));

        usdc.mint(user, AMOUNT);
        vm.deal(user, 100 ether);
    }

    // ─── supply ───────────────────────────────────────────────────────────

    function test_Supply_Success() public {
        vm.startPrank(user);
        usdc.approve(address(lend), AMOUNT);
        lend.supply(address(qiUSDC), AMOUNT);
        vm.stopPrank();

        assertEq(qiUSDC.balanceOf(user), AMOUNT);
        assertEq(usdc.balanceOf(user), 0);
    }

    function test_Supply_EmitsEvent() public {
        vm.startPrank(user);
        usdc.approve(address(lend), AMOUNT);

        vm.expectEmit(true, true, false, true);
        emit Supplied(user, address(qiUSDC), AMOUNT);
        lend.supply(address(qiUSDC), AMOUNT);
        vm.stopPrank();
    }

    function test_Supply_RevertIf_ZeroAmount() public {
        vm.prank(user);
        vm.expectRevert(PanoramaLend.ZeroAmount.selector);
        lend.supply(address(qiUSDC), 0);
    }

    function test_Supply_RevertIf_BenqiError() public {
        qiUSDC.setForcedError(5);

        vm.startPrank(user);
        usdc.approve(address(lend), AMOUNT);
        vm.expectRevert(abi.encodeWithSelector(PanoramaLend.BenqiError.selector, 5));
        lend.supply(address(qiUSDC), AMOUNT);
        vm.stopPrank();
    }

    // ─── redeem ───────────────────────────────────────────────────────────

    function test_Redeem_Success() public {
        vm.startPrank(user);
        usdc.approve(address(lend), AMOUNT);
        lend.supply(address(qiUSDC), AMOUNT);

        qiUSDC.approve(address(lend), AMOUNT);
        lend.redeem(address(qiUSDC), AMOUNT);
        vm.stopPrank();

        assertEq(usdc.balanceOf(user), AMOUNT);
        assertEq(qiUSDC.balanceOf(user), 0);
    }

    function test_Redeem_EmitsEvent() public {
        vm.startPrank(user);
        usdc.approve(address(lend), AMOUNT);
        lend.supply(address(qiUSDC), AMOUNT);

        qiUSDC.approve(address(lend), AMOUNT);
        vm.expectEmit(true, true, false, true);
        emit Redeemed(user, address(qiUSDC), AMOUNT);
        lend.redeem(address(qiUSDC), AMOUNT);
        vm.stopPrank();
    }

    function test_Redeem_RevertIf_ZeroAmount() public {
        vm.prank(user);
        vm.expectRevert(PanoramaLend.ZeroAmount.selector);
        lend.redeem(address(qiUSDC), 0);
    }

    function test_Redeem_RevertIf_BenqiError() public {
        vm.startPrank(user);
        usdc.approve(address(lend), AMOUNT);
        lend.supply(address(qiUSDC), AMOUNT);

        qiUSDC.setForcedError(3);
        qiUSDC.approve(address(lend), AMOUNT);
        vm.expectRevert(abi.encodeWithSelector(PanoramaLend.BenqiError.selector, 3));
        lend.redeem(address(qiUSDC), AMOUNT);
        vm.stopPrank();
    }

    // ─── borrow ───────────────────────────────────────────────────────────

    function test_Borrow_Success() public {
        uint256 borrowAmount = 500e6;

        vm.prank(user);
        lend.borrow(address(qiUSDC), borrowAmount);

        assertEq(usdc.balanceOf(user), AMOUNT + borrowAmount);
    }

    function test_Borrow_EmitsEvent() public {
        uint256 borrowAmount = 500e6;

        vm.startPrank(user);
        vm.expectEmit(true, true, false, true);
        emit Borrowed(user, address(qiUSDC), borrowAmount);
        lend.borrow(address(qiUSDC), borrowAmount);
        vm.stopPrank();
    }

    function test_Borrow_RevertIf_ZeroAmount() public {
        vm.prank(user);
        vm.expectRevert(PanoramaLend.ZeroAmount.selector);
        lend.borrow(address(qiUSDC), 0);
    }

    function test_Borrow_RevertIf_BenqiError() public {
        qiUSDC.setForcedError(4);

        vm.prank(user);
        vm.expectRevert(abi.encodeWithSelector(PanoramaLend.BenqiError.selector, 4));
        lend.borrow(address(qiUSDC), 500e6);
    }

    // ─── repay ────────────────────────────────────────────────────────────

    function test_Repay_Success() public {
        uint256 borrowAmount = 500e6;

        vm.prank(user);
        lend.borrow(address(qiUSDC), borrowAmount);

        vm.startPrank(user);
        usdc.approve(address(lend), borrowAmount);
        lend.repay(address(qiUSDC), borrowAmount);
        vm.stopPrank();

        assertEq(usdc.balanceOf(user), AMOUNT);
    }

    function test_Repay_EmitsEvent() public {
        uint256 repayAmount = 500e6;
        usdc.mint(user, repayAmount);

        vm.startPrank(user);
        usdc.approve(address(lend), repayAmount);
        vm.expectEmit(true, true, false, true);
        emit Repaid(user, address(qiUSDC), repayAmount);
        lend.repay(address(qiUSDC), repayAmount);
        vm.stopPrank();
    }

    function test_Repay_RevertIf_ZeroAmount() public {
        vm.prank(user);
        vm.expectRevert(PanoramaLend.ZeroAmount.selector);
        lend.repay(address(qiUSDC), 0);
    }

    // ─── supplyAVAX ───────────────────────────────────────────────────────

    function test_SupplyAVAX_Success() public {
        vm.prank(user);
        lend.supplyAVAX{value: AVAX_AMOUNT}();

        assertEq(qiAVAX.balanceOf(user), AVAX_AMOUNT);
        assertEq(user.balance, 100 ether - AVAX_AMOUNT);
    }

    function test_SupplyAVAX_EmitsEvent() public {
        vm.startPrank(user);
        vm.expectEmit(true, true, false, true);
        emit Supplied(user, address(qiAVAX), AVAX_AMOUNT);
        lend.supplyAVAX{value: AVAX_AMOUNT}();
        vm.stopPrank();
    }

    function test_SupplyAVAX_RevertIf_ZeroValue() public {
        vm.prank(user);
        vm.expectRevert(PanoramaLend.ZeroAmount.selector);
        lend.supplyAVAX{value: 0}();
    }

    // ─── redeemAVAX ───────────────────────────────────────────────────────

    function test_RedeemAVAX_Success() public {
        vm.prank(user);
        lend.supplyAVAX{value: AVAX_AMOUNT}();

        uint256 avaxBefore = user.balance;

        vm.startPrank(user);
        qiAVAX.approve(address(lend), AVAX_AMOUNT);
        lend.redeemAVAX(AVAX_AMOUNT);
        vm.stopPrank();

        assertEq(user.balance, avaxBefore + AVAX_AMOUNT);
        assertEq(qiAVAX.balanceOf(user), 0);
    }

    function test_RedeemAVAX_EmitsEvent() public {
        vm.prank(user);
        lend.supplyAVAX{value: AVAX_AMOUNT}();

        vm.startPrank(user);
        qiAVAX.approve(address(lend), AVAX_AMOUNT);
        vm.expectEmit(true, true, false, true);
        emit Redeemed(user, address(qiAVAX), AVAX_AMOUNT);
        lend.redeemAVAX(AVAX_AMOUNT);
        vm.stopPrank();
    }

    function test_RedeemAVAX_RevertIf_ZeroAmount() public {
        vm.prank(user);
        vm.expectRevert(PanoramaLend.ZeroAmount.selector);
        lend.redeemAVAX(0);
    }

    // ─── borrowAVAX ───────────────────────────────────────────────────────

    function test_BorrowAVAX_Success() public {
        uint256 avaxBefore = user.balance;

        vm.prank(user);
        lend.borrowAVAX(AVAX_AMOUNT);

        assertEq(user.balance, avaxBefore + AVAX_AMOUNT);
    }

    function test_BorrowAVAX_EmitsEvent() public {
        vm.startPrank(user);
        vm.expectEmit(true, true, false, true);
        emit Borrowed(user, address(qiAVAX), AVAX_AMOUNT);
        lend.borrowAVAX(AVAX_AMOUNT);
        vm.stopPrank();
    }

    function test_BorrowAVAX_RevertIf_ZeroAmount() public {
        vm.prank(user);
        vm.expectRevert(PanoramaLend.ZeroAmount.selector);
        lend.borrowAVAX(0);
    }

    // ─── repayAVAX ────────────────────────────────────────────────────────

    function test_RepayAVAX_Success() public {
        vm.prank(user);
        lend.borrowAVAX(AVAX_AMOUNT);

        uint256 avaxBefore = user.balance;

        vm.prank(user);
        lend.repayAVAX{value: AVAX_AMOUNT}();

        assertEq(user.balance, avaxBefore - AVAX_AMOUNT);
    }

    function test_RepayAVAX_EmitsEvent() public {
        vm.startPrank(user);
        vm.expectEmit(true, true, false, true);
        emit Repaid(user, address(qiAVAX), AVAX_AMOUNT);
        lend.repayAVAX{value: AVAX_AMOUNT}();
        vm.stopPrank();
    }

    function test_RepayAVAX_RevertIf_ZeroValue() public {
        vm.prank(user);
        vm.expectRevert(PanoramaLend.ZeroAmount.selector);
        lend.repayAVAX{value: 0}();
    }

    // ─── Immutables ───────────────────────────────────────────────────────

    function test_ComptrollerAndQiAVAXSet() public view {
        assertEq(address(lend.comptroller()), address(comptroller));
        assertEq(lend.qiAVAX(), address(qiAVAX));
    }

    function test_OwnerIsDeployer() public view {
        assertEq(lend.owner(), owner);
    }
}
