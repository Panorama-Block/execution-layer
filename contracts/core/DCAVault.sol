// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "../interfaces/IERC20.sol";
import {SafeTransferLib} from "../libraries/SafeTransferLib.sol";

interface IPanoramaExecutor {
    struct TokenTransfer { address token; uint256 amount; }
    function execute(
        bytes32 protocolId,
        bytes4  selector,
        TokenTransfer[] calldata transfers,
        uint256 deadline,
        bytes calldata data
    ) external payable returns (bytes memory);
}

/**
 * @title DCAVault
 * @notice Dollar-Cost Averaging vault for PanoramaBlock.
 * @dev Users deposit tokenIn and create DCA orders. A trusted keeper calls
 *      execute(orderId) at each interval, which approves PanoramaExecutor and
 *      triggers a swap. TokenOut is sent directly to the order owner.
 *
 *      Flow:
 *        1. User calls createOrder() with deposit amount
 *        2. User calls deposit() to top up balance (optional)
 *        3. Keeper calls execute(orderId) at each interval
 *        4. User calls cancel() + withdraw() at any time
 */
contract DCAVault {
    using SafeTransferLib for address;

    // ========== STRUCTS ==========

    struct Order {
        address owner;
        address tokenIn;
        address tokenOut;
        uint256 amountPerSwap;   // tokenIn amount per execution (in wei)
        uint256 interval;        // seconds between executions
        uint256 lastExecuted;    // timestamp of last successful execution
        uint256 remainingSwaps;  // 0 = unlimited
        uint256 balance;         // deposited tokenIn balance
        bool stable;             // aerodrome pool type
        bool active;
    }

    // ========== STATE ==========

    address public owner;
    address public keeper;
    address public executor;     // PanoramaExecutor

    uint256 public nextOrderId;
    mapping(uint256 => Order) public orders;
    mapping(address => uint256[]) private _userOrders;

    // ========== EVENTS ==========

    event OrderCreated(
        uint256 indexed orderId,
        address indexed owner,
        address tokenIn,
        address tokenOut,
        uint256 amountPerSwap,
        uint256 interval,
        uint256 remainingSwaps
    );
    event OrderExecuted(
        uint256 indexed orderId,
        address indexed owner,
        uint256 amountIn,
        uint256 timestamp
    );
    event OrderCancelled(uint256 indexed orderId, address indexed owner);
    event Deposited(uint256 indexed orderId, address indexed owner, uint256 amount);
    event Withdrawn(uint256 indexed orderId, address indexed owner, uint256 amount);
    event KeeperUpdated(address indexed oldKeeper, address indexed newKeeper);

    // ========== ERRORS ==========

    error Unauthorized();
    error OrderNotFound();
    error OrderInactive();
    error IntervalNotElapsed();
    error InsufficientBalance();
    error NoSwapsRemaining();
    error ZeroAmount();
    error ZeroAddress();
    error ZeroInterval();
    error Reentrancy();

    // ========== MODIFIERS ==========

    modifier onlyOwner() {
        if (msg.sender != owner) revert Unauthorized();
        _;
    }

    modifier onlyKeeper() {
        if (msg.sender != keeper) revert Unauthorized();
        _;
    }

    modifier onlyOrderOwner(uint256 orderId) {
        if (orders[orderId].owner != msg.sender) revert Unauthorized();
        _;
    }

    bool private _locked;
    modifier nonReentrant() {
        if (_locked) revert Reentrancy();
        _locked = true;
        _;
        _locked = false;
    }

    // ========== CONSTRUCTOR ==========

    constructor(address _keeper, address _executor) {
        if (_keeper == address(0) || _executor == address(0)) revert ZeroAddress();
        owner = msg.sender;
        keeper = _keeper;
        executor = _executor;
    }

    // ========== ORDER MANAGEMENT ==========

    /**
     * @notice Create a DCA order and deposit initial tokenIn balance.
     * @param tokenIn Token to sell (must be ERC-20).
     * @param tokenOut Token to buy.
     * @param amountPerSwap Amount of tokenIn to swap each execution.
     * @param interval Minimum seconds between executions.
     * @param remainingSwaps Total number of executions. 0 = unlimited.
     * @param stable Whether to use Aerodrome stable pool.
     * @param depositAmount Initial tokenIn amount to deposit.
     * @return orderId The new order ID.
     */
    function createOrder(
        address tokenIn,
        address tokenOut,
        uint256 amountPerSwap,
        uint256 interval,
        uint256 remainingSwaps,
        bool stable,
        uint256 depositAmount
    ) external nonReentrant returns (uint256 orderId) {
        if (tokenIn == address(0) || tokenOut == address(0)) revert ZeroAddress();
        if (amountPerSwap == 0) revert ZeroAmount();
        if (interval == 0) revert ZeroInterval();
        if (depositAmount == 0) revert ZeroAmount();

        orderId = nextOrderId++;

        orders[orderId] = Order({
            owner: msg.sender,
            tokenIn: tokenIn,
            tokenOut: tokenOut,
            amountPerSwap: amountPerSwap,
            interval: interval,
            lastExecuted: 0,
            remainingSwaps: remainingSwaps,
            balance: depositAmount,
            stable: stable,
            active: true
        });

        _userOrders[msg.sender].push(orderId);

        tokenIn.safeTransferFrom(msg.sender, address(this), depositAmount);

        emit OrderCreated(orderId, msg.sender, tokenIn, tokenOut, amountPerSwap, interval, remainingSwaps);
        emit Deposited(orderId, msg.sender, depositAmount);
    }

    /**
     * @notice Deposit additional tokenIn into an existing order.
     */
    function deposit(uint256 orderId, uint256 amount) external nonReentrant onlyOrderOwner(orderId) {
        if (amount == 0) revert ZeroAmount();
        Order storage order = orders[orderId];
        if (!order.active) revert OrderInactive();

        order.balance += amount;
        order.tokenIn.safeTransferFrom(msg.sender, address(this), amount);

        emit Deposited(orderId, msg.sender, amount);
    }

    /**
     * @notice Cancel an order and stop future executions.
     */
    function cancel(uint256 orderId) external onlyOrderOwner(orderId) {
        Order storage order = orders[orderId];
        if (!order.active) revert OrderInactive();
        order.active = false;
        emit OrderCancelled(orderId, msg.sender);
    }

    /**
     * @notice Withdraw remaining tokenIn balance from an order.
     * @dev Can be called on active or cancelled orders.
     */
    function withdraw(uint256 orderId) external nonReentrant onlyOrderOwner(orderId) {
        Order storage order = orders[orderId];
        uint256 balance = order.balance;
        if (balance == 0) revert InsufficientBalance();

        order.balance = 0;
        order.tokenIn.safeTransfer(msg.sender, balance);

        emit Withdrawn(orderId, msg.sender, balance);
    }

    // ========== EXECUTION ==========

    /**
     * @notice Execute a DCA swap for the given order.
     * @dev Only callable by the keeper. Approves PanoramaExecutor and calls executeSwap.
     *      The swap sends tokenOut directly to the order owner.
     * @param orderId Order to execute.
     * @param amountOutMin Minimum output enforced on PanoramaExecutor (slippage protection).
     * @param extraData ABI-encoded data forwarded to PanoramaExecutor.executeSwap (includes stable flag).
     * @param deadline Swap deadline timestamp.
     */
    function execute(
        uint256 orderId,
        uint256 amountOutMin,
        bytes calldata extraData,
        uint256 deadline
    ) external nonReentrant onlyKeeper {
        Order storage order = orders[orderId];

        if (!order.active) revert OrderInactive();
        if (order.remainingSwaps == 1) {
            // last swap — deactivate after execution
            order.active = false;
        } else if (order.remainingSwaps > 1) {
            order.remainingSwaps -= 1;
        }
        // remainingSwaps == 0 → unlimited, keep active

        if (block.timestamp < order.lastExecuted + order.interval) revert IntervalNotElapsed();
        if (order.balance < order.amountPerSwap) revert InsufficientBalance();

        order.balance -= order.amountPerSwap;
        order.lastExecuted = block.timestamp;

        // Approve executor to pull tokenIn
        _approve(order.tokenIn, executor, order.amountPerSwap);

        // Build protocolId for aerodrome
        bytes32 protocolId = keccak256(abi.encodePacked("aerodrome"));

        // Encode swap data for AerodromeAdapter
        bytes memory adapterData = abi.encode(
            order.tokenIn,
            order.tokenOut,
            order.amountPerSwap,
            amountOutMin,
            order.owner,
            order.stable
        );

        IPanoramaExecutor.TokenTransfer[] memory transfers = new IPanoramaExecutor.TokenTransfer[](1);
        transfers[0] = IPanoramaExecutor.TokenTransfer({
            token: order.tokenIn,
            amount: order.amountPerSwap
        });

        // Call PanoramaExecutor.execute — tokenOut goes to order owner
        IPanoramaExecutor(executor).execute(
            protocolId,
            bytes4(keccak256("swap")),
            transfers,
            deadline,
            adapterData
        );

        emit OrderExecuted(orderId, order.owner, order.amountPerSwap, block.timestamp);
    }

    // ========== VIEWS ==========

    /**
     * @notice Returns all order IDs for a given user.
     */
    function getUserOrders(address user) external view returns (uint256[] memory) {
        return _userOrders[user];
    }

    /**
     * @notice Returns full order data.
     */
    function getOrder(uint256 orderId) external view returns (Order memory) {
        return orders[orderId];
    }

    /**
     * @notice Returns true if the order is ready to be executed.
     */
    function isExecutable(uint256 orderId) external view returns (bool) {
        Order storage order = orders[orderId];
        return
            order.active &&
            order.balance >= order.amountPerSwap &&
            block.timestamp >= order.lastExecuted + order.interval;
    }

    /**
     * @notice Returns timestamp of next allowed execution.
     */
    function nextExecutionAt(uint256 orderId) external view returns (uint256) {
        return orders[orderId].lastExecuted + orders[orderId].interval;
    }

    // ========== ADMIN ==========

    function setKeeper(address newKeeper) external onlyOwner {
        if (newKeeper == address(0)) revert ZeroAddress();
        emit KeeperUpdated(keeper, newKeeper);
        keeper = newKeeper;
    }

    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert ZeroAddress();
        owner = newOwner;
    }

    // ========== INTERNAL ==========

    function _approve(address token, address spender, uint256 amount) internal {
        IERC20(token).approve(spender, 0);
        IERC20(token).approve(spender, amount);
    }
}
