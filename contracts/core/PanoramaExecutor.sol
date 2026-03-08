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
    /// @notice Implementation contracts for each protocol (used as clone templates)
    mapping(bytes32 => address) public adapterImplementations;
    /// @notice Per-user adapter clones: protocolId => user => clone address
    mapping(bytes32 => mapping(address => address)) public userAdapters;
    bool private _locked;

    // ========== EVENTS ==========

    event AdapterRegistered(bytes32 indexed protocolId, address indexed implementation);
    event AdapterRemoved(bytes32 indexed protocolId, address indexed oldImplementation);
    event UserAdapterCreated(address indexed user, bytes32 indexed protocolId, address adapter);
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
