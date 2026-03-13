// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "../interfaces/IERC20.sol";
import {SafeTransferLib} from "../libraries/SafeTransferLib.sol";
import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";

/**
 * @title PanoramaExecutor
 * @notice Protocol-neutral entry point for PanoramaBlock on-chain execution.
 * @dev Routes arbitrary DeFi operations to per-user adapter clones (EIP-1167).
 *
 *      The executor has NO knowledge of specific actions (swap, stake, etc.).
 *      It only:
 *        1. Creates/retrieves the user's adapter clone for the given protocol
 *        2. Pulls ERC-20 tokens from the user into the adapter
 *        3. Forwards the call to the adapter via low-level call(action, data)
 *
 *      Adding a new protocol: deploy adapter + registerAdapter(). No executor changes.
 *      Adding a new action: implement it on the adapter. No executor changes.
 */
contract PanoramaExecutor {
    using SafeTransferLib for address;

    // ========== TYPES ==========

    /// @notice A token transfer to pull from the caller into the adapter before execution.
    struct Transfer {
        address token;
        uint256 amount;
    }

    // ========== CONSTANTS ==========

    uint256 public constant ADAPTER_REMOVAL_DELAY = 1 days;

    // ========== STATE ==========

    address public owner;
    address public pendingOwner;
    /// @notice Implementation contracts for each protocol (used as EIP-1167 clone templates).
    mapping(bytes32 => address) public adapterImplementations;
    /// @notice Per-user adapter clones: protocolId => user => clone address.
    mapping(bytes32 => mapping(address => address)) public userAdapters;
    /// @notice Contracts authorised to call executeSwapFor (e.g. DCAVault).
    mapping(address => bool) public authorizedOperators;
    /// @notice Scheduled adapter removals: protocolId => unlockAt timestamp (0 = not scheduled).
    mapping(bytes32 => uint256) public pendingAdapterRemovals;
    bool private _locked;

    // ========== EVENTS ==========

    event AdapterRegistered(bytes32 indexed protocolId, address indexed implementation);
    event AdapterRemoved(bytes32 indexed protocolId, address indexed oldImplementation);
    event AdapterRemovalScheduled(bytes32 indexed protocolId, uint256 unlockAt);
    event AdapterRemovalCancelled(bytes32 indexed protocolId);
    event UserAdapterCreated(address indexed user, bytes32 indexed protocolId, address adapter);
    event OperatorUpdated(address indexed operator, bool authorized);
    event OwnershipProposed(address indexed proposed);
    event OwnershipTransferred(address indexed oldOwner, address indexed newOwner);
    /// @notice Emitted on every successful execute() / executeSwapFor() call.
    event OperationExecuted(
        address indexed user,
        bytes32 indexed protocolId,
        bytes4 indexed action,
        bytes result
    );

    // ========== ERRORS ==========

    error Unauthorized();
    error AdapterNotRegistered();
    error DeadlineExpired();
    error TransferFailed();
    error Reentrancy();
    error ZeroAddress();
    error ExecutionFailed(bytes reason);
    error OperatorNotAuthorized();
    error RemovalNotScheduled();
    error RemovalDelayNotElapsed();

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

    // ========== CONSTRUCTOR ==========

    constructor() {
        owner = msg.sender;
    }

    // ========== ADAPTER MANAGEMENT ==========

    /**
     * @notice Get or create a per-user adapter clone for the calling user.
     * @dev Uses EIP-1167 minimal proxy (Clones.cloneDeterministic).
     *      The clone shares the implementation's immutable state (router, voter, etc.)
     *      but has its own storage — each user gets isolated gauge positions and rewards.
     */
    function _getOrCreateUserAdapter(bytes32 protocolId) internal returns (address adapter) {
        return _getOrCreateUserAdapterFor(protocolId, msg.sender);
    }

    /**
     * @notice Get or create a per-user adapter clone for an arbitrary user address.
     * @dev Used by executeSwapFor so authorised operators can act in a user's adapter context.
     */
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

    /// @notice Get the adapter clone address for a user (view, does not create).
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

    // ========== CORE EXECUTE ==========

    /**
     * @notice Protocol-neutral execution entry point.
     * @dev Pulls tokens from caller into the user's adapter clone, then calls
     *      the adapter with bytes.concat(action, data). The executor has zero
     *      knowledge of action semantics — fully protocol-agnostic.
     *
     * @param protocolId  bytes32 identifier for the protocol (e.g. keccak256("aerodrome"))
     * @param action      bytes4 Solidity function selector on the adapter
     * @param transfers   ERC-20 tokens to pull from caller into the adapter before execution
     * @param deadline    Unix timestamp — reverts if exceeded
     * @param data        ABI-encoded parameters for the adapter function (without selector)
     * @return result     Raw bytes returned by the adapter
     */
    function execute(
        bytes32 protocolId,
        bytes4 action,
        Transfer[] calldata transfers,
        uint256 deadline,
        bytes calldata data
    ) external payable nonReentrant beforeDeadline(deadline) returns (bytes memory result) {
        address adapter = _getOrCreateUserAdapter(protocolId);

        // Pull ERC-20 tokens from user into adapter
        for (uint256 i = 0; i < transfers.length; i++) {
            transfers[i].token.safeTransferFrom(msg.sender, adapter, transfers[i].amount);
        }

        // Forward call to adapter — executor has no knowledge of action semantics
        bool success;
        (success, result) = adapter.call{value: msg.value}(
            bytes.concat(action, data)
        );

        if (!success) {
            if (result.length > 0) {
                // Bubble up the revert reason verbatim from the adapter
                assembly {
                    revert(add(result, 32), mload(result))
                }
            }
            revert ExecutionFailed(result);
        }

        emit OperationExecuted(msg.sender, protocolId, action, result);
    }

    /**
     * @notice Execute an operation in the context of `user`'s adapter clone.
     * @dev Only callable by authorised operators (e.g. DCAVault).
     *      Tokens are pulled from msg.sender (the operator) — the operator must hold
     *      the tokenIn and have approved this executor before calling.
     *      This preserves per-user adapter isolation for operator-initiated flows.
     *
     * @param user       The end-user whose adapter clone should be used.
     * @param protocolId Protocol identifier (e.g. keccak256("aerodrome")).
     * @param action     bytes4 Solidity function selector on the adapter.
     * @param transfers  ERC-20 tokens to pull from the operator into the user's adapter.
     * @param deadline   Unix timestamp — reverts if exceeded.
     * @param data       ABI-encoded parameters for the adapter function (without selector).
     * @return result    Raw bytes returned by the adapter.
     */
    function executeSwapFor(
        address user,
        bytes32 protocolId,
        bytes4 action,
        Transfer[] calldata transfers,
        uint256 deadline,
        bytes calldata data
    ) external payable nonReentrant beforeDeadline(deadline) returns (bytes memory result) {
        if (!authorizedOperators[msg.sender]) revert OperatorNotAuthorized();

        address adapter = _getOrCreateUserAdapterFor(protocolId, user);

        // Pull ERC-20 tokens from the operator (e.g. DCAVault) into the user's adapter
        for (uint256 i = 0; i < transfers.length; i++) {
            transfers[i].token.safeTransferFrom(msg.sender, adapter, transfers[i].amount);
        }

        bool success;
        (success, result) = adapter.call{value: msg.value}(
            bytes.concat(action, data)
        );

        if (!success) {
            if (result.length > 0) {
                assembly {
                    revert(add(result, 32), mload(result))
                }
            }
            revert ExecutionFailed(result);
        }

        emit OperationExecuted(user, protocolId, action, result);
    }

    // ========== ADMIN ==========

    /**
     * @notice Register a protocol adapter implementation (used as EIP-1167 clone template).
     * @param protocolId     Identifier for the protocol (e.g. keccak256("aerodrome")).
     * @param implementation Address of the deployed adapter implementation.
     */
    function registerAdapter(bytes32 protocolId, address implementation) external onlyOwner {
        if (implementation == address(0)) revert ZeroAddress();
        adapterImplementations[protocolId] = implementation;
        emit AdapterRegistered(protocolId, implementation);
    }

    /**
     * @notice Schedule a delayed adapter removal. Must be finalised after ADAPTER_REMOVAL_DELAY.
     */
    function scheduleAdapterRemoval(bytes32 protocolId) external onlyOwner {
        if (adapterImplementations[protocolId] == address(0)) revert AdapterNotRegistered();
        uint256 unlockAt = block.timestamp + ADAPTER_REMOVAL_DELAY;
        pendingAdapterRemovals[protocolId] = unlockAt;
        emit AdapterRemovalScheduled(protocolId, unlockAt);
    }

    /**
     * @notice Finalise a scheduled adapter removal after the delay has elapsed.
     */
    function executeAdapterRemoval(bytes32 protocolId) external onlyOwner {
        uint256 unlockAt = pendingAdapterRemovals[protocolId];
        if (unlockAt == 0) revert RemovalNotScheduled();
        if (block.timestamp < unlockAt) revert RemovalDelayNotElapsed();
        address old = adapterImplementations[protocolId];
        delete adapterImplementations[protocolId];
        delete pendingAdapterRemovals[protocolId];
        emit AdapterRemoved(protocolId, old);
    }

    /**
     * @notice Cancel a previously scheduled adapter removal.
     */
    function cancelAdapterRemoval(bytes32 protocolId) external onlyOwner {
        if (pendingAdapterRemovals[protocolId] == 0) revert RemovalNotScheduled();
        delete pendingAdapterRemovals[protocolId];
        emit AdapterRemovalCancelled(protocolId);
    }

    /**
     * @notice Authorise or revoke an operator contract (e.g. DCAVault) to call executeSwapFor.
     */
    function setAuthorizedOperator(address operator, bool authorized) external onlyOwner {
        if (operator == address(0)) revert ZeroAddress();
        authorizedOperators[operator] = authorized;
        emit OperatorUpdated(operator, authorized);
    }

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
