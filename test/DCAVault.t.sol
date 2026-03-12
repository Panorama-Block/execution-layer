// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import {DCAVault} from "../contracts/core/DCAVault.sol";
import {MockERC20} from "./mocks/MockERC20.sol";

// ---------------------------------------------------------------------------
// MockExecutor — simulates PanoramaExecutor.executeSwap behaviour:
//   - pulls tokenIn from vault (vault approved it)
//   - sends tokenOut to msg.sender (the vault), mimicking the real executor
//     where recipient = msg.sender
// ---------------------------------------------------------------------------
contract MockExecutor {
    // rate: 1 tokenIn = 2 tokenOut (integer, no decimals)
    uint256 public constant RATE = 2;
    bool public shouldRevert;
    bytes public revertData;

    function setRevert(bool _should, bytes calldata _data) external {
        shouldRevert = _should;
        revertData = _data;
    }

    fallback(bytes calldata) external returns (bytes memory) {
        if (shouldRevert) {
            bytes memory data = revertData;
            assembly {
                revert(add(32, data), mload(data))
            }
        }

        // Decode executeSwap args: (bytes32, address tokenIn, address tokenOut, uint256 amountIn, ...)
        // We only need tokenIn, tokenOut, amountIn
        (, address tokenIn, address tokenOut, uint256 amountIn,,,) =
            abi.decode(msg.data[4:], (bytes32, address, address, uint256, uint256, bytes, uint256));

        // Pull tokenIn from vault (vault already approved us)
        MockERC20(tokenIn).transferFrom(msg.sender, address(this), amountIn);

        // Send tokenOut to vault (msg.sender) — this is what the real executor does
        uint256 amountOut = amountIn * RATE;
        MockERC20(tokenOut).transfer(msg.sender, amountOut);

        return abi.encode(amountOut);
    }
}

// ---------------------------------------------------------------------------
// DCAVaultTest
// ---------------------------------------------------------------------------
contract DCAVaultTest is Test {
    DCAVault public vault;
    MockExecutor public mockExecutor;
    MockERC20 public tokenIn;
    MockERC20 public tokenOut;

    address public owner = address(this);
    address public keeper = address(0xBEEF);
    address public user = address(0xCAFE);
    address public user2 = address(0xDEAD);

    uint256 constant AMOUNT_PER_SWAP = 100e6;  // 100 USDC-like
    uint256 constant INTERVAL = 1 days;
    uint256 constant DEPOSIT = 500e6;          // 5 swaps worth

    function setUp() public {
        tokenIn = new MockERC20("USD Coin", "USDC", 6);
        tokenOut = new MockERC20("Wrapped Ether", "WETH", 18);
        mockExecutor = new MockExecutor();

        vault = new DCAVault(keeper, address(mockExecutor));

        // Fund executor with tokenOut so it can pay out
        tokenOut.mint(address(mockExecutor), 1_000_000e18);

        // Fund users with tokenIn
        tokenIn.mint(user, 10_000e6);
        tokenIn.mint(user2, 10_000e6);

        // Warp past first interval so execute() doesn't hit IntervalNotElapsed
        // (lastExecuted = 0, so block.timestamp must be >= INTERVAL)
        vm.warp(INTERVAL + 1);
    }

    // ========== CONSTRUCTOR ==========

    function test_Constructor() public view {
        assertEq(vault.owner(), owner);
        assertEq(vault.keeper(), keeper);
        assertEq(vault.executor(), address(mockExecutor));
    }

    function test_Constructor_ZeroKeeper_Reverts() public {
        vm.expectRevert(DCAVault.ZeroAddress.selector);
        new DCAVault(address(0), address(mockExecutor));
    }

    function test_Constructor_ZeroExecutor_Reverts() public {
        vm.expectRevert(DCAVault.ZeroAddress.selector);
        new DCAVault(keeper, address(0));
    }

    // ========== CREATE ORDER ==========

    function test_CreateOrder() public {
        vm.startPrank(user);
        tokenIn.approve(address(vault), DEPOSIT);

        uint256 orderId = vault.createOrder(
            address(tokenIn), address(tokenOut), AMOUNT_PER_SWAP, INTERVAL, 5, false, DEPOSIT
        );
        vm.stopPrank();

        assertEq(orderId, 0);
        DCAVault.Order memory order = vault.getOrder(0);
        assertEq(order.owner, user);
        assertEq(order.tokenIn, address(tokenIn));
        assertEq(order.tokenOut, address(tokenOut));
        assertEq(order.amountPerSwap, AMOUNT_PER_SWAP);
        assertEq(order.interval, INTERVAL);
        assertEq(order.remainingSwaps, 5);
        assertEq(order.balance, DEPOSIT);
        assertEq(order.stable, false);
        assertTrue(order.active);

        assertEq(tokenIn.balanceOf(address(vault)), DEPOSIT);
    }

    function test_CreateOrder_ZeroAmount_Reverts() public {
        vm.startPrank(user);
        tokenIn.approve(address(vault), DEPOSIT);
        vm.expectRevert(DCAVault.ZeroAmount.selector);
        vault.createOrder(address(tokenIn), address(tokenOut), 0, INTERVAL, 5, false, DEPOSIT);
        vm.stopPrank();
    }

    function test_CreateOrder_ZeroInterval_Reverts() public {
        vm.startPrank(user);
        tokenIn.approve(address(vault), DEPOSIT);
        vm.expectRevert(DCAVault.ZeroInterval.selector);
        vault.createOrder(address(tokenIn), address(tokenOut), AMOUNT_PER_SWAP, 0, 5, false, DEPOSIT);
        vm.stopPrank();
    }

    function test_CreateOrder_ZeroDeposit_Reverts() public {
        vm.startPrank(user);
        tokenIn.approve(address(vault), DEPOSIT);
        vm.expectRevert(DCAVault.ZeroAmount.selector);
        vault.createOrder(address(tokenIn), address(tokenOut), AMOUNT_PER_SWAP, INTERVAL, 5, false, 0);
        vm.stopPrank();
    }

    function test_CreateOrder_ZeroTokenAddress_Reverts() public {
        vm.startPrank(user);
        tokenIn.approve(address(vault), DEPOSIT);
        vm.expectRevert(DCAVault.ZeroAddress.selector);
        vault.createOrder(address(0), address(tokenOut), AMOUNT_PER_SWAP, INTERVAL, 5, false, DEPOSIT);
        vm.stopPrank();
    }

    // ========== DEPOSIT ==========

    function test_Deposit() public {
        uint256 orderId = _createOrder(user);

        vm.startPrank(user);
        tokenIn.approve(address(vault), 200e6);
        vault.deposit(orderId, 200e6);
        vm.stopPrank();

        assertEq(vault.getOrder(orderId).balance, DEPOSIT + 200e6);
    }

    function test_Deposit_NotOwner_Reverts() public {
        uint256 orderId = _createOrder(user);

        vm.startPrank(user2);
        tokenIn.approve(address(vault), 200e6);
        vm.expectRevert(DCAVault.Unauthorized.selector);
        vault.deposit(orderId, 200e6);
        vm.stopPrank();
    }

    // ========== CANCEL ==========

    function test_Cancel() public {
        uint256 orderId = _createOrder(user);

        vm.prank(user);
        vault.cancel(orderId);

        assertFalse(vault.getOrder(orderId).active);
    }

    function test_Cancel_NotOwner_Reverts() public {
        uint256 orderId = _createOrder(user);
        vm.prank(user2);
        vm.expectRevert(DCAVault.Unauthorized.selector);
        vault.cancel(orderId);
    }

    function test_Cancel_AlreadyCancelled_Reverts() public {
        uint256 orderId = _createOrder(user);
        vm.prank(user);
        vault.cancel(orderId);
        vm.prank(user);
        vm.expectRevert(DCAVault.OrderInactive.selector);
        vault.cancel(orderId);
    }

    // ========== WITHDRAW ==========

    function test_Withdraw() public {
        uint256 orderId = _createOrder(user);

        vm.startPrank(user);
        vault.cancel(orderId);
        uint256 balBefore = tokenIn.balanceOf(user);
        vault.withdraw(orderId);
        vm.stopPrank();

        assertEq(tokenIn.balanceOf(user) - balBefore, DEPOSIT);
        assertEq(vault.getOrder(orderId).balance, 0);
    }

    function test_Withdraw_ZeroBalance_Reverts() public {
        uint256 orderId = _createOrder(user);
        vm.prank(user);
        vault.cancel(orderId);
        vm.prank(user);
        vault.withdraw(orderId);
        vm.prank(user);
        vm.expectRevert(DCAVault.InsufficientBalance.selector);
        vault.withdraw(orderId);
    }

    function test_Withdraw_NotOwner_Reverts() public {
        uint256 orderId = _createOrder(user);
        vm.prank(user);
        vault.cancel(orderId);
        vm.prank(user2);
        vm.expectRevert(DCAVault.Unauthorized.selector);
        vault.withdraw(orderId);
    }

    // ========== EXECUTE ==========

    function test_Execute_ForwardsTokenOutToOwner() public {
        uint256 orderId = _createOrder(user);

        uint256 ownerBalBefore = tokenOut.balanceOf(user);
        uint256 vaultBalBefore = tokenOut.balanceOf(address(vault));

        _execute(orderId);

        // TokenOut must arrive at order.owner, NOT stay in vault
        uint256 expectedOut = AMOUNT_PER_SWAP * MockExecutor(payable(address(mockExecutor))).RATE();
        assertEq(tokenOut.balanceOf(user) - ownerBalBefore, expectedOut, "owner did not receive tokenOut");
        assertEq(tokenOut.balanceOf(address(vault)), vaultBalBefore, "tokenOut leaked into vault");

        // tokenIn deducted from order balance
        assertEq(vault.getOrder(orderId).balance, DEPOSIT - AMOUNT_PER_SWAP);
    }

    function test_Execute_DecrementsRemainingSwaps() public {
        uint256 orderId = _createOrder(user);
        assertEq(vault.getOrder(orderId).remainingSwaps, 5);
        _execute(orderId);
        assertEq(vault.getOrder(orderId).remainingSwaps, 4);
    }

    function test_Execute_LastSwap_DeactivatesOrder() public {
        // Create order with only 1 swap
        vm.startPrank(user);
        tokenIn.approve(address(vault), AMOUNT_PER_SWAP);
        uint256 orderId = vault.createOrder(
            address(tokenIn), address(tokenOut), AMOUNT_PER_SWAP, INTERVAL, 1, false, AMOUNT_PER_SWAP
        );
        vm.stopPrank();

        _execute(orderId);

        assertFalse(vault.getOrder(orderId).active);
    }

    function test_Execute_UnlimitedSwaps_StaysActive() public {
        // remainingSwaps = 0 means unlimited
        vm.startPrank(user);
        tokenIn.approve(address(vault), DEPOSIT);
        uint256 orderId = vault.createOrder(
            address(tokenIn), address(tokenOut), AMOUNT_PER_SWAP, INTERVAL, 0, false, DEPOSIT
        );
        vm.stopPrank();

        _execute(orderId);
        assertTrue(vault.getOrder(orderId).active);
        assertEq(vault.getOrder(orderId).remainingSwaps, 0);
    }

    function test_Execute_IntervalNotElapsed_Reverts() public {
        uint256 orderId = _createOrder(user);
        _execute(orderId);

        // Try again immediately — interval hasn't passed
        vm.prank(keeper);
        vm.expectRevert(DCAVault.IntervalNotElapsed.selector);
        vault.execute(orderId, 0, abi.encode(false), block.timestamp + 1 hours);
    }

    function test_Execute_AfterInterval_Succeeds() public {
        uint256 orderId = _createOrder(user);
        _execute(orderId);

        vm.warp(block.timestamp + INTERVAL + 1);
        _execute(orderId);

        assertEq(vault.getOrder(orderId).balance, DEPOSIT - 2 * AMOUNT_PER_SWAP);
    }

    function test_Execute_InsufficientBalance_Reverts() public {
        // Create order with exactly 1 swap of balance
        vm.startPrank(user);
        tokenIn.approve(address(vault), AMOUNT_PER_SWAP);
        uint256 orderId = vault.createOrder(
            address(tokenIn), address(tokenOut), AMOUNT_PER_SWAP, INTERVAL, 2, false, AMOUNT_PER_SWAP
        );
        vm.stopPrank();

        _execute(orderId); // drains balance, sets remainingSwaps=1

        vm.warp(block.timestamp + INTERVAL + 1);
        vm.prank(keeper);
        vm.expectRevert(DCAVault.InsufficientBalance.selector);
        vault.execute(orderId, 0, abi.encode(false), block.timestamp + 1 hours);
    }

    function test_Execute_InactiveOrder_Reverts() public {
        uint256 orderId = _createOrder(user);
        vm.prank(user);
        vault.cancel(orderId);

        vm.prank(keeper);
        vm.expectRevert(DCAVault.OrderInactive.selector);
        vault.execute(orderId, 0, abi.encode(false), block.timestamp + 1 hours);
    }

    function test_Execute_OnlyKeeper_Reverts() public {
        uint256 orderId = _createOrder(user);
        vm.prank(user);
        vm.expectRevert(DCAVault.Unauthorized.selector);
        vault.execute(orderId, 0, abi.encode(false), block.timestamp + 1 hours);
    }

    function test_Execute_BubblesRevertReason() public {
        uint256 orderId = _createOrder(user);

        // Make executor revert with a custom error
        bytes memory customError = abi.encodeWithSignature("InsufficientOutput()");
        mockExecutor.setRevert(true, customError);

        vm.prank(keeper);
        // Expect the exact revert data from executor to bubble up
        vm.expectRevert(bytes4(keccak256("InsufficientOutput()")));
        vault.execute(orderId, 0, abi.encode(false), block.timestamp + 1 hours);
    }

    // ========== IS EXECUTABLE ==========

    function test_IsExecutable_True() public {
        uint256 orderId = _createOrder(user);
        assertTrue(vault.isExecutable(orderId));
    }

    function test_IsExecutable_False_AfterExecution() public {
        uint256 orderId = _createOrder(user);
        _execute(orderId);
        assertFalse(vault.isExecutable(orderId)); // interval not elapsed
    }

    function test_IsExecutable_True_AfterInterval() public {
        uint256 orderId = _createOrder(user);
        _execute(orderId);
        vm.warp(block.timestamp + INTERVAL + 1);
        assertTrue(vault.isExecutable(orderId));
    }

    // ========== TWO-STEP KEEPER ==========

    function test_ProposeAndAcceptKeeper() public {
        address newKeeper = address(0x1234);

        vault.proposeKeeper(newKeeper);
        assertEq(vault.pendingKeeper(), newKeeper);

        vm.prank(newKeeper);
        vault.acceptKeeper();

        assertEq(vault.keeper(), newKeeper);
        assertEq(vault.pendingKeeper(), address(0));
    }

    function test_ProposeKeeper_OnlyOwner_Reverts() public {
        vm.prank(user);
        vm.expectRevert(DCAVault.Unauthorized.selector);
        vault.proposeKeeper(address(0x1234));
    }

    function test_AcceptKeeper_WrongCaller_Reverts() public {
        vault.proposeKeeper(address(0x1234));
        vm.prank(user);
        vm.expectRevert(DCAVault.Unauthorized.selector);
        vault.acceptKeeper();
    }

    function test_ProposeKeeper_ZeroAddress_Reverts() public {
        vm.expectRevert(DCAVault.ZeroAddress.selector);
        vault.proposeKeeper(address(0));
    }

    // ========== TWO-STEP EXECUTOR ==========

    function test_ProposeAndAcceptExecutor() public {
        address newExec = address(0x5678);

        vault.proposeExecutor(newExec);
        assertEq(vault.pendingExecutor(), newExec);

        vault.acceptExecutor();

        assertEq(vault.executor(), newExec);
        assertEq(vault.pendingExecutor(), address(0));
    }

    function test_AcceptExecutor_NoPending_Reverts() public {
        vm.expectRevert(DCAVault.NoPendingProposal.selector);
        vault.acceptExecutor();
    }

    function test_ProposeExecutor_OnlyOwner_Reverts() public {
        vm.prank(user);
        vm.expectRevert(DCAVault.Unauthorized.selector);
        vault.proposeExecutor(address(0x5678));
    }

    // ========== TWO-STEP OWNERSHIP ==========

    function test_ProposeAndAcceptOwnership() public {
        address newOwner = address(0xABCD);

        vault.proposeOwner(newOwner);
        assertEq(vault.pendingOwner(), newOwner);

        vm.prank(newOwner);
        vault.acceptOwnership();

        assertEq(vault.owner(), newOwner);
        assertEq(vault.pendingOwner(), address(0));
    }

    function test_ProposeOwner_OnlyOwner_Reverts() public {
        vm.prank(user);
        vm.expectRevert(DCAVault.Unauthorized.selector);
        vault.proposeOwner(address(0xABCD));
    }

    function test_AcceptOwnership_WrongCaller_Reverts() public {
        vault.proposeOwner(address(0xABCD));
        vm.prank(user);
        vm.expectRevert(DCAVault.Unauthorized.selector);
        vault.acceptOwnership();
    }

    function test_ProposeOwner_ZeroAddress_Reverts() public {
        vm.expectRevert(DCAVault.ZeroAddress.selector);
        vault.proposeOwner(address(0));
    }

    // ========== GET USER ORDERS ==========

    function test_GetUserOrders() public {
        uint256 id0 = _createOrder(user);
        uint256 id1 = _createOrder(user);

        uint256[] memory ids = vault.getUserOrders(user);
        assertEq(ids.length, 2);
        assertEq(ids[0], id0);
        assertEq(ids[1], id1);
    }

    // ========== HELPERS ==========

    function _createOrder(address _user) internal returns (uint256 orderId) {
        vm.startPrank(_user);
        tokenIn.approve(address(vault), DEPOSIT);
        orderId = vault.createOrder(
            address(tokenIn), address(tokenOut), AMOUNT_PER_SWAP, INTERVAL, 5, false, DEPOSIT
        );
        vm.stopPrank();
    }

    function _execute(uint256 orderId) internal {
        vm.prank(keeper);
        vault.execute(orderId, 0, abi.encode(false), block.timestamp + 1 hours);
    }
}
