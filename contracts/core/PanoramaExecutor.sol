// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IProtocolAdapter} from "../interfaces/IProtocolAdapter.sol";
import {IERC20} from "../interfaces/IERC20.sol";
import {SafeTransferLib} from "../libraries/SafeTransferLib.sol";
import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";

/**
 * @title PanoramaExecutor
 * @notice Core entry point for PanoramaBlock on-chain execution.
 * @dev Routes DeFi operations to per-user adapter clones (EIP-1167).
 *      Each user gets their own adapter clone, isolating positions and rewards.
 *      Users approve tokens to this contract. It transfers tokens to the user's
 *      adapter clone, executes operations, and returns results.
 */
contract PanoramaExecutor {
    using SafeTransferLib for address;

    // ========== STATE ==========

    address public owner;
    address public pendingOwner;
    uint256 public ownershipTransferUnlockAt;
    /// @notice Implementation contracts for each protocol (used as clone templates)
    mapping(bytes32 => address) public adapterImplementations;
    /// @notice Per-user adapter clones: protocolId => user => clone address
    mapping(bytes32 => mapping(address => address)) public userAdapters;
    /// @notice Trusted operators that may execute swaps on behalf of a user (e.g. DCA vaults).
    mapping(address => bool) public authorizedOperators;
    mapping(address => PendingOperatorChange) public pendingOperatorChanges;
    mapping(bytes32 => PendingAdapterRemoval) public pendingAdapterRemovals;
    bool private _locked;

    uint256 public constant ADMIN_DELAY = 1 days;

    struct PendingOperatorChange {
        bool authorized;
        uint256 executeAfter;
        bool exists;
    }

    struct PendingAdapterRemoval {
        uint256 executeAfter;
        bool exists;
    }

    // ========== EVENTS ==========

    event AdapterRegistered(bytes32 indexed protocolId, address indexed implementation);
    event AdapterRemoved(bytes32 indexed protocolId, address indexed oldImplementation);
    event UserAdapterCreated(address indexed user, bytes32 indexed protocolId, address adapter);
    event OwnershipTransferStarted(address indexed currentOwner, address indexed pendingOwner, uint256 executeAfter);
    event OwnershipTransferred(address indexed oldOwner, address indexed newOwner);
    event OperatorChangeScheduled(address indexed operator, bool authorized, uint256 executeAfter);
    event OperatorChangeCancelled(address indexed operator);
    event OperatorChangeExecuted(address indexed operator, bool authorized);
    event AdapterRemovalScheduled(bytes32 indexed protocolId, uint256 executeAfter);
    event AdapterRemovalCancelled(bytes32 indexed protocolId);
    event SwapExecuted(
        address indexed user,
        bytes32 indexed protocolId,
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 amountOut
    );
    event LiquidityAdded(
        address indexed user,
        bytes32 indexed protocolId,
        address tokenA,
        address tokenB,
        bool stable,
        uint256 liquidity
    );
    event LiquidityRemoved(
        address indexed user,
        bytes32 indexed protocolId,
        address tokenA,
        address tokenB,
        bool stable,
        uint256 amountA,
        uint256 amountB
    );
    event StakeExecuted(address indexed user, bytes32 indexed protocolId, address lpToken, uint256 amount);
    event UnstakeExecuted(address indexed user, bytes32 indexed protocolId, address lpToken, uint256 amount);
    event RewardsClaimed(address indexed user, bytes32 indexed protocolId, address lpToken, uint256 rewardAmount);

    // ========== ERRORS ==========

    error Unauthorized();
    error AdapterNotRegistered();
    error DeadlineExpired();
    error InvalidAmount();
    error InsufficientOutput();
    error TransferFailed();
    error Reentrancy();
    error ZeroAddress();
    error InvalidToken();
    error AlreadyRegistered();
    error DelayNotElapsed();
    error NoPendingChange();

    // ========== MODIFIERS ==========

    modifier onlyOwner() {
        if (msg.sender != owner) revert Unauthorized();
        _;
    }

    modifier nonReentrant() {
        if (_locked) revert Reentrancy();
        _locked = true;
        _;
        _locked = false;
    }

    modifier beforeDeadline(uint256 deadline) {
        if (block.timestamp > deadline) revert DeadlineExpired();
        _;
    }

    modifier onlyAuthorizedOperator() {
        if (!authorizedOperators[msg.sender]) revert Unauthorized();
        _;
    }

    // ========== CONSTRUCTOR ==========

    constructor() {
        owner = msg.sender;
    }

    // ========== USER ADAPTER MANAGEMENT ==========

    /**
     * @notice Get or create a per-user adapter clone for the calling user.
     * @dev Uses EIP-1167 minimal proxy (Clones.cloneDeterministic).
     *      The clone shares the implementation's immutable state (router, voter, etc.)
     *      but has its own storage, so each user gets isolated gauge positions and rewards.
     */
    function _getOrCreateUserAdapter(bytes32 protocolId) internal returns (address adapter) {
        return _getOrCreateUserAdapterFor(protocolId, msg.sender);
    }

    function _getOrCreateUserAdapterFor(bytes32 protocolId, address user) internal returns (address adapter) {
        adapter = userAdapters[protocolId][user];
        if (adapter == address(0)) {
            address implementation = adapterImplementations[protocolId];
            if (implementation == address(0)) revert AdapterNotRegistered();
            bytes32 salt = keccak256(abi.encodePacked(user, protocolId));
            adapter = Clones.cloneDeterministic(implementation, salt);
            userAdapters[protocolId][user] = adapter;
            emit UserAdapterCreated(user, protocolId, adapter);
        }
    }

    /**
     * @notice Get the adapter clone address for a user (view, does not create).
     * @return adapter The clone address, or address(0) if not yet created.
     */
    function getUserAdapter(bytes32 protocolId, address user) external view returns (address) {
        return userAdapters[protocolId][user];
    }

    /**
     * @notice Predict the deterministic clone address for a user (even before creation).
     * @dev Useful for the backend to query gauge balances before the user's first operation.
     */
    function predictUserAdapter(bytes32 protocolId, address user) external view returns (address) {
        address implementation = adapterImplementations[protocolId];
        if (implementation == address(0)) return address(0);
        bytes32 salt = keccak256(abi.encodePacked(user, protocolId));
        return Clones.predictDeterministicAddress(implementation, salt);
    }

    // ========== SWAP ==========

    function executeSwap(
        bytes32 protocolId,
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 amountOutMin,
        bytes calldata extraData,
        uint256 deadline
    ) external payable nonReentrant beforeDeadline(deadline) returns (uint256 amountOut) {
        if (amountIn == 0) revert InvalidAmount();
        address adapter = _getOrCreateUserAdapter(protocolId);

        if (tokenIn == address(0)) {
            amountOut = IProtocolAdapter(adapter).swap{value: msg.value}(
                tokenIn, tokenOut, amountIn, amountOutMin, msg.sender, extraData
            );
        } else {
            tokenIn.safeTransferFrom(msg.sender, adapter, amountIn);
            amountOut = IProtocolAdapter(adapter).swap(
                tokenIn, tokenOut, amountIn, amountOutMin, msg.sender, extraData
            );
        }

        if (amountOut < amountOutMin) revert InsufficientOutput();
        emit SwapExecuted(msg.sender, protocolId, tokenIn, tokenOut, amountIn, amountOut);
    }

    /**
     * @notice Execute a swap funded by a trusted operator while preserving the end user's adapter isolation.
     * @dev Used by automation contracts such as DCAVault. Tokens are pulled from `tokenPayer`,
     *      positions remain attributed to `adapterOwner`, and swap proceeds are sent to `recipient`.
     */
    function executeSwapFor(
        bytes32 protocolId,
        address adapterOwner,
        address tokenPayer,
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 amountOutMin,
        address recipient,
        bytes calldata extraData,
        uint256 deadline
    ) external payable nonReentrant beforeDeadline(deadline) onlyAuthorizedOperator returns (uint256 amountOut) {
        if (adapterOwner == address(0) || tokenPayer == address(0) || recipient == address(0)) revert ZeroAddress();
        if (tokenIn == address(0)) revert InvalidToken();
        if (amountIn == 0) revert InvalidAmount();

        address adapter = _getOrCreateUserAdapterFor(protocolId, adapterOwner);
        tokenIn.safeTransferFrom(tokenPayer, adapter, amountIn);
        amountOut = IProtocolAdapter(adapter).swap(tokenIn, tokenOut, amountIn, amountOutMin, recipient, extraData);

        if (amountOut < amountOutMin) revert InsufficientOutput();
        emit SwapExecuted(adapterOwner, protocolId, tokenIn, tokenOut, amountIn, amountOut);
    }

    // ========== LIQUIDITY ==========

    function executeAddLiquidity(
        bytes32 protocolId,
        address tokenA,
        address tokenB,
        bool stable,
        uint256 amountADesired,
        uint256 amountBDesired,
        uint256 amountAMin,
        uint256 amountBMin,
        bytes calldata extraData,
        uint256 deadline
    ) external payable nonReentrant beforeDeadline(deadline) returns (uint256 liquidity) {
        if (amountADesired == 0 || amountBDesired == 0) revert InvalidAmount();
        if (tokenA == address(0) || tokenB == address(0)) revert InvalidToken();
        address adapter = _getOrCreateUserAdapter(protocolId);

        tokenA.safeTransferFrom(msg.sender, adapter, amountADesired);
        tokenB.safeTransferFrom(msg.sender, adapter, amountBDesired);

        liquidity = IProtocolAdapter(adapter).addLiquidity(
            tokenA, tokenB, stable, amountADesired, amountBDesired, amountAMin, amountBMin, msg.sender, extraData
        );

        emit LiquidityAdded(msg.sender, protocolId, tokenA, tokenB, stable, liquidity);
    }

    function executeRemoveLiquidity(
        bytes32 protocolId,
        address tokenA,
        address tokenB,
        bool stable,
        uint256 liquidity,
        uint256 amountAMin,
        uint256 amountBMin,
        bytes calldata extraData,
        uint256 deadline
    ) external nonReentrant beforeDeadline(deadline) returns (uint256 amountA, uint256 amountB) {
        if (liquidity == 0) revert InvalidAmount();
        if (tokenA == address(0) || tokenB == address(0)) revert InvalidToken();
        address adapter = _getOrCreateUserAdapter(protocolId);

        address pool = abi.decode(extraData, (address));
        pool.safeTransferFrom(msg.sender, adapter, liquidity);

        (amountA, amountB) = IProtocolAdapter(adapter).removeLiquidity(
            tokenA, tokenB, stable, liquidity, amountAMin, amountBMin, msg.sender, extraData
        );

        emit LiquidityRemoved(msg.sender, protocolId, tokenA, tokenB, stable, amountA, amountB);
    }

    // ========== STAKING ==========

    function executeStake(bytes32 protocolId, address lpToken, uint256 amount, bytes calldata extraData)
        external
        nonReentrant
    {
        if (amount == 0) revert InvalidAmount();
        address adapter = _getOrCreateUserAdapter(protocolId);

        lpToken.safeTransferFrom(msg.sender, adapter, amount);
        IProtocolAdapter(adapter).stake(lpToken, amount, extraData);

        emit StakeExecuted(msg.sender, protocolId, lpToken, amount);
    }

    function executeUnstake(bytes32 protocolId, address lpToken, uint256 amount, bytes calldata extraData)
        external
        nonReentrant
    {
        if (amount == 0) revert InvalidAmount();
        address adapter = _getOrCreateUserAdapter(protocolId);

        IProtocolAdapter(adapter).unstake(lpToken, amount, extraData);

        // Forward unstaked LP tokens back to user
        lpToken.safeTransfer(msg.sender, amount);

        emit UnstakeExecuted(msg.sender, protocolId, lpToken, amount);
    }

    // ========== CLAIM REWARDS ==========

    function executeClaimRewards(bytes32 protocolId, address lpToken, bytes calldata extraData)
        external
        nonReentrant
        returns (uint256 rewardAmount)
    {
        address adapter = _getOrCreateUserAdapter(protocolId);
        rewardAmount = IProtocolAdapter(adapter).claimRewards(lpToken, msg.sender, extraData);
        emit RewardsClaimed(msg.sender, protocolId, lpToken, rewardAmount);
    }

    // ========== ADMIN ==========

    /**
     * @notice Register a protocol adapter implementation (used as clone template).
     * @param protocolId Identifier for the protocol (e.g., keccak256("aerodrome")).
     * @param implementation Address of the adapter implementation contract.
     */
    function registerAdapter(bytes32 protocolId, address implementation) external onlyOwner {
        if (implementation == address(0)) revert ZeroAddress();
        if (adapterImplementations[protocolId] != address(0)) revert AlreadyRegistered();
        adapterImplementations[protocolId] = implementation;
        emit AdapterRegistered(protocolId, implementation);
    }

    function setAuthorizedOperator(address operator, bool authorized) external onlyOwner {
        if (operator == address(0)) revert ZeroAddress();
        pendingOperatorChanges[operator] = PendingOperatorChange({
            authorized: authorized,
            executeAfter: block.timestamp + ADMIN_DELAY,
            exists: true
        });
        emit OperatorChangeScheduled(operator, authorized, block.timestamp + ADMIN_DELAY);
    }

    function executeAuthorizedOperatorChange(address operator) external onlyOwner {
        PendingOperatorChange memory change = pendingOperatorChanges[operator];
        if (!change.exists) revert NoPendingChange();
        if (block.timestamp < change.executeAfter) revert DelayNotElapsed();
        authorizedOperators[operator] = change.authorized;
        delete pendingOperatorChanges[operator];
        emit OperatorChangeExecuted(operator, change.authorized);
    }

    function cancelAuthorizedOperatorChange(address operator) external onlyOwner {
        if (!pendingOperatorChanges[operator].exists) revert NoPendingChange();
        delete pendingOperatorChanges[operator];
        emit OperatorChangeCancelled(operator);
    }

    function removeAdapter(bytes32 protocolId) external onlyOwner {
        if (adapterImplementations[protocolId] == address(0)) revert AdapterNotRegistered();
        pendingAdapterRemovals[protocolId] =
            PendingAdapterRemoval({executeAfter: block.timestamp + ADMIN_DELAY, exists: true});
        emit AdapterRemovalScheduled(protocolId, block.timestamp + ADMIN_DELAY);
    }

    function executeAdapterRemoval(bytes32 protocolId) external onlyOwner {
        PendingAdapterRemoval memory pending = pendingAdapterRemovals[protocolId];
        if (!pending.exists) revert NoPendingChange();
        if (block.timestamp < pending.executeAfter) revert DelayNotElapsed();
        address old = adapterImplementations[protocolId];
        delete adapterImplementations[protocolId];
        delete pendingAdapterRemovals[protocolId];
        emit AdapterRemoved(protocolId, old);
    }

    function cancelAdapterRemoval(bytes32 protocolId) external onlyOwner {
        if (!pendingAdapterRemovals[protocolId].exists) revert NoPendingChange();
        delete pendingAdapterRemovals[protocolId];
        emit AdapterRemovalCancelled(protocolId);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert ZeroAddress();
        pendingOwner = newOwner;
        ownershipTransferUnlockAt = block.timestamp + ADMIN_DELAY;
        emit OwnershipTransferStarted(owner, newOwner, ownershipTransferUnlockAt);
    }

    function acceptOwnership() external {
        if (msg.sender != pendingOwner) revert Unauthorized();
        if (block.timestamp < ownershipTransferUnlockAt) revert DelayNotElapsed();
        address oldOwner = owner;
        owner = pendingOwner;
        pendingOwner = address(0);
        ownershipTransferUnlockAt = 0;
        emit OwnershipTransferred(oldOwner, owner);
    }

    function emergencyWithdraw() external onlyOwner {
        (bool success,) = owner.call{value: address(this).balance}("");
        if (!success) revert TransferFailed();
    }

    function emergencyWithdrawERC20(address token) external onlyOwner {
        uint256 balance = IERC20(token).balanceOf(address(this));
        token.safeTransfer(owner, balance);
    }

    // ========== FALLBACK ==========

    receive() external payable {}
}
