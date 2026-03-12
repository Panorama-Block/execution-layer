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

    // ========== STATE ==========

    address public owner;
    /// @notice Implementation contracts for each protocol (used as EIP-1167 clone templates).
    mapping(bytes32 => address) public adapterImplementations;
    /// @notice Per-user adapter clones: protocolId => user => clone address.
    mapping(bytes32 => mapping(address => address)) public userAdapters;
    bool private _locked;

    // ========== EVENTS ==========

    event AdapterRegistered(bytes32 indexed protocolId, address indexed implementation);
    event AdapterRemoved(bytes32 indexed protocolId, address indexed oldImplementation);
    event UserAdapterCreated(address indexed user, bytes32 indexed protocolId, address adapter);
    /// @notice Emitted on every successful execute() call. The executor does not interpret result.
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

    function removeAdapter(bytes32 protocolId) external onlyOwner {
        address old = adapterImplementations[protocolId];
        delete adapterImplementations[protocolId];
        emit AdapterRemoved(protocolId, old);
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
