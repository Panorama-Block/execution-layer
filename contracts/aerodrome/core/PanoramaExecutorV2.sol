// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "../interfaces/IERC20.sol";
import {SafeTransferLib} from "../libraries/SafeTransferLib.sol";
import {BeaconProxy} from "@openzeppelin/contracts/proxy/beacon/BeaconProxy.sol";

/**
 * @title PanoramaExecutorV2
 * @notice Protocol-neutral entry point for PanoramaBlock on-chain execution.
 * @dev Upgrade from V1: replaces EIP-1167 minimal proxies with BeaconProxy.
 *
 *      Why BeaconProxy:
 *        - EIP-1167 clones hardcode the implementation address in bytecode — NOT upgradeable.
 *        - BeaconProxy queries a Beacon contract for the current implementation at every call.
 *        - Upgrading ALL user clones = single `beacon.upgradeTo(newImpl)` call.
 *
 *      The executor has NO knowledge of specific actions (swap, stake, etc.).
 *      It only:
 *        1. Creates/retrieves the user's BeaconProxy clone for the given protocol
 *        2. Pulls ERC-20 tokens from the user into the proxy
 *        3. Forwards the call to the proxy via low-level call(action, data)
 *
 *      Each protocol has its own UpgradeableBeacon (one beacon per protocol).
 *      All user proxies for that protocol share the same beacon → same implementation.
 *
 *      Adding a new protocol: deploy adapter + deploy beacon + registerBeacon(). No executor changes.
 *      Adding a new action: implement it on the adapter. No executor changes.
 *      Upgrading an adapter: deploy new impl + beacon.upgradeTo(newImpl). All users upgraded instantly.
 */
contract PanoramaExecutorV2 {
    using SafeTransferLib for address;

    // ========== TYPES ==========

    /// @notice A token transfer to pull from the caller into the adapter before execution.
    struct Transfer {
        address token;
        uint256 amount;
    }

    // ========== CONSTANTS ==========

    uint256 public constant BEACON_REMOVAL_DELAY = 1 days;

    // ========== STATE ==========

    address public owner;
    address public pendingOwner;

    /// @notice UpgradeableBeacon address for each protocol.
    ///         The beacon stores the current adapter implementation.
    ///         All user proxies for this protocol delegate to beacon's current impl.
    mapping(bytes32 => address) public protocolBeacons;

    /// @notice ABI-encoded initializer arguments per protocol (e.g. router, voter addresses).
    ///         Stored at registration time. Used to initialize each new BeaconProxy.
    ///         The executor prepends its own address before calling the adapter's initializer.
    mapping(bytes32 => bytes) public protocolInitArgs;

    /// @notice Per-user BeaconProxy clones: protocolId => user => proxy address.
    mapping(bytes32 => mapping(address => address)) public userAdapters;

    /// @notice Contracts authorised to call executeSwapFor (e.g. DCAVault).
    mapping(address => bool) public authorizedOperators;

    /// @notice Scheduled beacon removals: protocolId => unlockAt timestamp (0 = not scheduled).
    mapping(bytes32 => uint256) public pendingBeaconRemovals;

    bool private _locked;

    // ========== EVENTS ==========

    event BeaconRegistered(bytes32 indexed protocolId, address indexed beacon);
    event BeaconRemoved(bytes32 indexed protocolId, address indexed oldBeacon);
    event BeaconRemovalScheduled(bytes32 indexed protocolId, uint256 unlockAt);
    event BeaconRemovalCancelled(bytes32 indexed protocolId);
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
    error BeaconNotRegistered();
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
     * @notice Get or create a per-user BeaconProxy for the calling user.
     * @dev Creates a BeaconProxy that points to the protocol's UpgradeableBeacon.
     *      The proxy has its own storage (isolated gauge positions, rewards, etc.)
     *      but delegates all calls to the beacon's current implementation.
     *
     *      Uses CREATE2 (salt = keccak256(user, protocolId)) for deterministic addresses.
     *      The proxy is initialized with `initialize(executor)` on creation.
     */
    function _getOrCreateUserAdapter(bytes32 protocolId) internal returns (address adapter) {
        return _getOrCreateUserAdapterFor(protocolId, msg.sender);
    }

    /**
     * @notice Get or create a per-user BeaconProxy for an arbitrary user address.
     * @dev Used by executeSwapFor so authorised operators can act in a user's adapter context.
     */
    function _getOrCreateUserAdapterFor(bytes32 protocolId, address user) internal returns (address adapter) {
        adapter = userAdapters[protocolId][user];
        if (adapter == address(0)) {
            address beacon = protocolBeacons[protocolId];
            if (beacon == address(0)) revert BeaconNotRegistered();

            bytes32 salt = keccak256(abi.encodePacked(user, protocolId));

            // Build initializer calldata: initializeFull(executor, ...protocolArgs)
            // protocolInitArgs stores the ABI-encoded protocol-specific params (e.g. router, voter).
            // We prepend the executor address so the adapter knows who can call it.
            bytes memory storedArgs = protocolInitArgs[protocolId];
            bytes memory initData = abi.encodeWithSignature(
                "initializeFull(address,bytes)", address(this), storedArgs
            );

            adapter = address(new BeaconProxy{salt: salt}(beacon, initData));
            userAdapters[protocolId][user] = adapter;
            emit UserAdapterCreated(user, protocolId, adapter);
        }
    }

    /// @notice Get the adapter proxy address for a user (view, does not create).
    function getUserAdapter(bytes32 protocolId, address user) external view returns (address) {
        return userAdapters[protocolId][user];
    }

    /**
     * @notice Predict the deterministic proxy address for a user (even before creation).
     * @dev Uses CREATE2 address prediction. Useful for the backend to query gauge balances
     *      before the user's first operation.
     */
    function predictUserAdapter(bytes32 protocolId, address user) external view returns (address) {
        address beacon = protocolBeacons[protocolId];
        if (beacon == address(0)) return address(0);

        bytes32 salt = keccak256(abi.encodePacked(user, protocolId));
        bytes memory storedArgs = protocolInitArgs[protocolId];
        bytes memory initData = abi.encodeWithSignature(
            "initializeFull(address,bytes)", address(this), storedArgs
        );
        bytes memory creationCode = abi.encodePacked(type(BeaconProxy).creationCode, abi.encode(beacon, initData));

        bytes32 hash = keccak256(abi.encodePacked(bytes1(0xff), address(this), salt, keccak256(creationCode)));
        return address(uint160(uint256(hash)));
    }

    // ========== CORE EXECUTE ==========

    /**
     * @notice Protocol-neutral execution entry point.
     * @dev Pulls tokens from caller into the user's BeaconProxy, then calls
     *      the proxy with bytes.concat(action, data). The executor has zero
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

        // Pull ERC-20 tokens from user into adapter proxy
        for (uint256 i = 0; i < transfers.length; i++) {
            transfers[i].token.safeTransferFrom(msg.sender, adapter, transfers[i].amount);
        }

        // Forward call to adapter — executor has no knowledge of action semantics
        bool success;
        (success, result) = adapter.call{value: msg.value}(bytes.concat(action, data));

        if (!success) {
            if (result.length > 0) {
                assembly {
                    revert(add(result, 32), mload(result))
                }
            }
            revert ExecutionFailed(result);
        }

        emit OperationExecuted(msg.sender, protocolId, action, result);
    }

    /**
     * @notice Execute an operation in the context of `user`'s adapter proxy.
     * @dev Only callable by authorised operators (e.g. DCAVault).
     *      Tokens are pulled from msg.sender (the operator) — the operator must hold
     *      the tokenIn and have approved this executor before calling.
     *
     * @param user       The end-user whose adapter proxy should be used.
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

        for (uint256 i = 0; i < transfers.length; i++) {
            transfers[i].token.safeTransferFrom(msg.sender, adapter, transfers[i].amount);
        }

        bool success;
        (success, result) = adapter.call{value: msg.value}(bytes.concat(action, data));

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
     * @notice Register a protocol's UpgradeableBeacon with its initializer arguments.
     * @dev The beacon stores the current adapter implementation. All user BeaconProxies
     *      for this protocol will delegate to whatever implementation the beacon points to.
     *      To upgrade all users: call beacon.upgradeTo(newImpl) on the beacon directly.
     *
     *      initArgs are ABI-encoded protocol-specific params passed to the adapter's
     *      initializeFull() when creating each user proxy. For Aerodrome:
     *        abi.encode(routerAddress, voterAddress)
     *
     * @param protocolId Identifier for the protocol (e.g. keccak256("aerodrome")).
     * @param beacon     Address of the deployed UpgradeableBeacon for this protocol.
     * @param initArgs   ABI-encoded protocol config passed to adapter initializer.
     */
    function registerBeacon(bytes32 protocolId, address beacon, bytes calldata initArgs) external onlyOwner {
        if (beacon == address(0)) revert ZeroAddress();
        protocolBeacons[protocolId] = beacon;
        protocolInitArgs[protocolId] = initArgs;
        emit BeaconRegistered(protocolId, beacon);
    }

    /**
     * @notice Schedule a delayed beacon removal. Must be finalised after BEACON_REMOVAL_DELAY.
     */
    function scheduleBeaconRemoval(bytes32 protocolId) external onlyOwner {
        if (protocolBeacons[protocolId] == address(0)) revert BeaconNotRegistered();
        uint256 unlockAt = block.timestamp + BEACON_REMOVAL_DELAY;
        pendingBeaconRemovals[protocolId] = unlockAt;
        emit BeaconRemovalScheduled(protocolId, unlockAt);
    }

    /**
     * @notice Finalise a scheduled beacon removal after the delay has elapsed.
     */
    function executeBeaconRemoval(bytes32 protocolId) external onlyOwner {
        uint256 unlockAt = pendingBeaconRemovals[protocolId];
        if (unlockAt == 0) revert RemovalNotScheduled();
        if (block.timestamp < unlockAt) revert RemovalDelayNotElapsed();
        address old = protocolBeacons[protocolId];
        delete protocolBeacons[protocolId];
        delete pendingBeaconRemovals[protocolId];
        emit BeaconRemoved(protocolId, old);
    }

    /**
     * @notice Cancel a previously scheduled beacon removal.
     */
    function cancelBeaconRemoval(bytes32 protocolId) external onlyOwner {
        if (pendingBeaconRemovals[protocolId] == 0) revert RemovalNotScheduled();
        delete pendingBeaconRemovals[protocolId];
        emit BeaconRemovalCancelled(protocolId);
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
