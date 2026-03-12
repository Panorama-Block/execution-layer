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
 *      adapter clone via the TokenTransfer[] parameter, then calls execute() on
 *      the adapter with a generic selector + data payload.
 */
contract PanoramaExecutor {
    using SafeTransferLib for address;

    // ========== STRUCTS ==========

    /// @notice Describes a token transfer from user to their adapter clone.
    /// @dev token == address(0) means native ETH — skip pull (ETH forwarded via msg.value).
    struct TokenTransfer {
        address token;
        uint256 amount;
    }

    // ========== STATE ==========

    address public owner;
    /// @notice Implementation contracts for each protocol (used as clone templates)
    mapping(bytes32 => address) public adapterImplementations;
    /// @notice Per-user adapter clones: protocolId => user => clone address
    mapping(bytes32 => mapping(address => address)) public userAdapters;
    bool private _locked;

    // ========== EVENTS ==========

    event AdapterRegistered(bytes32 indexed protocolId, address indexed implementation);
    event AdapterRemoved(bytes32 indexed protocolId, address indexed oldImplementation);
    event UserAdapterCreated(address indexed user, bytes32 indexed protocolId, address adapter);
    event OperationExecuted(
        address indexed user,
        bytes32 indexed protocolId,
        bytes4 indexed selector,
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

    // ========== USER ADAPTER MANAGEMENT ==========

    /**
     * @notice Get or create a per-user adapter clone for the calling user.
     * @dev Uses EIP-1167 minimal proxy (Clones.cloneDeterministic).
     *      The clone shares the implementation's immutable state (router, voter, etc.)
     *      but has its own storage, so each user gets isolated gauge positions and rewards.
     */
    function _getOrCreateUserAdapter(bytes32 protocolId) internal returns (address adapter) {
        adapter = userAdapters[protocolId][msg.sender];
        if (adapter == address(0)) {
            address implementation = adapterImplementations[protocolId];
            if (implementation == address(0)) revert AdapterNotRegistered();
            bytes32 salt = keccak256(abi.encodePacked(msg.sender, protocolId));
            adapter = Clones.cloneDeterministic(implementation, salt);
            userAdapters[protocolId][msg.sender] = adapter;
            emit UserAdapterCreated(msg.sender, protocolId, adapter);
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

    // ========== EXECUTE ==========

    /**
     * @notice Generic execution entry point. Routes any operation to the user's adapter clone.
     * @param protocolId Protocol identifier (e.g. keccak256("aerodrome")).
     * @param selector   Operation selector (e.g. bytes4(keccak256("swap"))).
     * @param transfers  ERC-20 tokens to pull from user into their adapter clone before execution.
     *                   Entries with token == address(0) are skipped (native ETH is forwarded via msg.value).
     * @param deadline   Transaction must execute before this timestamp.
     * @param data       ABI-encoded operation parameters forwarded to the adapter.
     * @return result    ABI-encoded return data from the adapter.
     */
    function execute(
        bytes32 protocolId,
        bytes4  selector,
        TokenTransfer[] calldata transfers,
        uint256 deadline,
        bytes   calldata data
    ) external payable nonReentrant beforeDeadline(deadline) returns (bytes memory result) {
        address adapter = _getOrCreateUserAdapter(protocolId);

        // Pull ERC-20 tokens from user into their adapter clone
        for (uint256 i = 0; i < transfers.length; i++) {
            if (transfers[i].token != address(0) && transfers[i].amount > 0) {
                transfers[i].token.safeTransferFrom(msg.sender, adapter, transfers[i].amount);
            }
        }

        // Dispatch to adapter
        (bool success, bytes memory returnData) = adapter.call{value: msg.value}(
            abi.encodeWithSelector(IProtocolAdapter.execute.selector, selector, data)
        );

        if (!success) {
            revert ExecutionFailed(returnData);
        }

        // Decode the outer ABI encoding added by the Solidity call
        result = abi.decode(returnData, (bytes));

        emit OperationExecuted(msg.sender, protocolId, selector, result);
    }

    // ========== ADMIN ==========

    /**
     * @notice Register a protocol adapter implementation (used as clone template).
     * @param protocolId Identifier for the protocol (e.g., keccak256("aerodrome")).
     * @param implementation Address of the adapter implementation contract.
     */
    function registerAdapter(bytes32 protocolId, address implementation) external onlyOwner {
        if (implementation == address(0)) revert ZeroAddress();
        adapterImplementations[protocolId] = implementation;
        emit AdapterRegistered(protocolId, implementation);
    }

    function removeAdapter(bytes32 protocolId) external onlyOwner {
        address old = adapterImplementations[protocolId];
        delete adapterImplementations[protocolId];
        emit AdapterRemoved(protocolId, old);
    }

    /**
     * @notice Clear a user's adapter clone mapping, enabling re-creation with a new implementation.
     * @dev Used during adapter migrations. The old clone continues to exist on-chain but will
     *      no longer be used for new operations. Enumerate UserAdapterCreated events off-chain
     *      to find all users that need clearing.
     */
    function clearUserAdapter(bytes32 protocolId, address user) external onlyOwner {
        delete userAdapters[protocolId][user];
    }

    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert ZeroAddress();
        owner = newOwner;
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
