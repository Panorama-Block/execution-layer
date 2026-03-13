// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "../interfaces/IERC20.sol";
import {SafeTransferLib} from "../libraries/SafeTransferLib.sol";
import {IPanoramaExecutor} from "../interfaces/IPanoramaExecutor.sol";

/**
 * @title DCAVault
 * @notice Dollar-Cost Averaging vault for PanoramaBlock.
 * @dev Users deposit tokenIn and create DCA orders. A trusted keeper calls
 *      execute(orderId) at each interval, which approves PanoramaExecutor and
 *      triggers a swap. TokenOut is forwarded directly to the order owner.
 *
 *      Flow:
 *        1. User calls createOrder() with deposit amount
 *        2. User calls deposit() to top up balance (optional)
 *        3. Keeper calls execute(orderId) at each interval
 *        4. User calls cancel() + withdraw() at any time
 *
 *      Safety:
 *        - Keeper and executor updates use a two-step propose/accept pattern
 *        - Ownership transfer also uses two-step pattern
 *        - Swap revert reasons are bubbled up verbatim
 *        - TokenOut is forwarded to order.owner (not trapped in vault)
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
    address public pendingOwner;

    address public keeper;
    address public pendingKeeper;

    address public executor;     // PanoramaExecutor
    address public pendingExecutor;

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
        uint256 amountOut,
        uint256 timestamp
    );
    event OrderCancelled(uint256 indexed orderId, address indexed owner);
    event Deposited(uint256 indexed orderId, address indexed owner, uint256 amount);
    event Withdrawn(uint256 indexed orderId, address indexed owner, uint256 amount);

    // Two-step admin events
    event KeeperProposed(address indexed proposed);
    event KeeperUpdated(address indexed oldKeeper, address indexed newKeeper);
    event ExecutorProposed(address indexed proposed);
    event ExecutorUpdated(address indexed oldExecutor, address indexed newExecutor);
    event OwnershipProposed(address indexed proposed);
    event OwnershipTransferred(address indexed oldOwner, address indexed newOwner);

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
    error NoPendingProposal();

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
     * @dev Only callable by the keeper. Calls PanoramaExecutor.execute() and forwards
     *      the received tokenOut directly to order.owner.
     *      Real revert reasons from PanoramaExecutor are bubbled up verbatim.
     * @param orderId Order to execute.
     * @param amountOutMin Minimum output enforced on PanoramaExecutor (slippage protection).
     * @param deadline Swap deadline timestamp.
     */
    function execute(
        uint256 orderId,
        uint256 amountOutMin,
        bytes calldata, /* extraData — reserved for future adapter params */
        uint256 deadline
    ) external nonReentrant onlyKeeper {
        Order storage order = orders[orderId];

        if (!order.active) revert OrderInactive();
        if (order.remainingSwaps == 1) {
            order.active = false;
        } else if (order.remainingSwaps > 1) {
            order.remainingSwaps -= 1;
        }
        // remainingSwaps == 0 → unlimited, keep active

        if (block.timestamp < order.lastExecuted + order.interval) revert IntervalNotElapsed();
        if (order.balance < order.amountPerSwap) revert InsufficientBalance();

        order.balance -= order.amountPerSwap;
        order.lastExecuted = block.timestamp;

        // Approve executor to pull tokenIn from this vault
        _approve(order.tokenIn, executor, order.amountPerSwap);

        // Snapshot tokenOut balance before swap so we know how much arrived
        uint256 balBefore = IERC20(order.tokenOut).balanceOf(address(this));

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

        IPanoramaExecutor.Transfer[] memory transfers = new IPanoramaExecutor.Transfer[](1);
        transfers[0] = IPanoramaExecutor.Transfer({
            token: order.tokenIn,
            amount: order.amountPerSwap
        });

        // Call PanoramaExecutor.execute — tokenOut goes to order owner via adapter
        // Typed call automatically propagates reverts from PanoramaExecutor
        IPanoramaExecutor(executor).execute(
            protocolId,
            bytes4(keccak256("swap(address,address,uint256,uint256,address,bool)")),
            transfers,
            deadline,
            adapterData
        );

        // Snapshot any tokenOut that landed in this vault and forward to owner
        // (defensive: works whether adapter forwards directly or sends to vault)
        uint256 balAfter = IERC20(order.tokenOut).balanceOf(address(this));
        uint256 amountOut = balAfter - balBefore;
        if (amountOut > 0) {
            order.tokenOut.safeTransfer(order.owner, amountOut);
        }

        emit OrderExecuted(orderId, order.owner, order.amountPerSwap, amountOut, block.timestamp);
    }

    // ========== VIEWS ==========

    function getUserOrders(address user) external view returns (uint256[] memory) {
        return _userOrders[user];
    }

    function getOrder(uint256 orderId) external view returns (Order memory) {
        return orders[orderId];
    }

    function isExecutable(uint256 orderId) external view returns (bool) {
        Order storage order = orders[orderId];
        return
            order.active &&
            order.balance >= order.amountPerSwap &&
            block.timestamp >= order.lastExecuted + order.interval;
    }

    function nextExecutionAt(uint256 orderId) external view returns (uint256) {
        return orders[orderId].lastExecuted + orders[orderId].interval;
    }

    // ========== ADMIN — TWO-STEP PATTERNS ==========

    // --- Keeper ---

    /**
     * @notice Propose a new keeper. Must be accepted by the proposed address.
     */
    function proposeKeeper(address newKeeper) external onlyOwner {
        if (newKeeper == address(0)) revert ZeroAddress();
        pendingKeeper = newKeeper;
        emit KeeperProposed(newKeeper);
    }

    /**
     * @notice Accept keeper role. Must be called by the proposed address.
     */
    function acceptKeeper() external {
        if (msg.sender != pendingKeeper) revert Unauthorized();
        emit KeeperUpdated(keeper, pendingKeeper);
        keeper = pendingKeeper;
        pendingKeeper = address(0);
    }

    // --- Executor ---

    /**
     * @notice Propose a new PanoramaExecutor address.
     */
    function proposeExecutor(address newExecutor) external onlyOwner {
        if (newExecutor == address(0)) revert ZeroAddress();
        pendingExecutor = newExecutor;
        emit ExecutorProposed(newExecutor);
    }

    /**
     * @notice Accept new executor. Must be called by the owner after proposing.
     * @dev Intentionally requires owner re-confirmation (not the executor itself).
     */
    function acceptExecutor() external onlyOwner {
        if (pendingExecutor == address(0)) revert NoPendingProposal();
        emit ExecutorUpdated(executor, pendingExecutor);
        executor = pendingExecutor;
        pendingExecutor = address(0);
    }

    // --- Ownership ---

    /**
     * @notice Propose a new owner. Must be accepted by the proposed address.
     */
    function proposeOwner(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert ZeroAddress();
        pendingOwner = newOwner;
        emit OwnershipProposed(newOwner);
    }

    /**
     * @notice Accept ownership. Must be called by the proposed address.
     */
    function acceptOwnership() external {
        if (msg.sender != pendingOwner) revert Unauthorized();
        emit OwnershipTransferred(owner, pendingOwner);
        owner = pendingOwner;
        pendingOwner = address(0);
    }

    // ========== INTERNAL ==========

    function _approve(address token, address spender, uint256 amount) internal {
        IERC20(token).approve(spender, 0);
        IERC20(token).approve(spender, amount);
    }
}
