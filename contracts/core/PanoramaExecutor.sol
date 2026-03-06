// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IProtocolAdapter} from "../interfaces/IProtocolAdapter.sol";
import {IERC20} from "../interfaces/IERC20.sol";
import {SafeTransferLib} from "../libraries/SafeTransferLib.sol";

/**
 * @title PanoramaExecutor
 * @notice Core entry point for PanoramaBlock on-chain execution.
 * @dev Routes DeFi operations to registered protocol adapters.
 *      Users approve tokens to this contract. It transfers tokens to adapters,
 *      executes operations, and returns results to the user in a single transaction.
 *
 *      Design based on ValidatedLending.sol pattern from panorama-block-backend.
 */
contract PanoramaExecutor {
    using SafeTransferLib for address;

    // ========== STATE ==========

    address public owner;
    mapping(bytes32 => address) public adapters;
    bool private _locked;

    // ========== EVENTS ==========

    event AdapterRegistered(bytes32 indexed protocolId, address indexed adapter);
    event AdapterRemoved(bytes32 indexed protocolId, address indexed oldAdapter);
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

    // ========== SWAP ==========

    /**
     * @notice Execute a token swap through a registered protocol adapter.
     * @param protocolId Identifier for the protocol (e.g., keccak256("aerodrome")).
     * @param tokenIn Input token address (address(0) for native ETH).
     * @param tokenOut Output token address.
     * @param amountIn Amount of input tokens.
     * @param amountOutMin Minimum acceptable output (slippage protection).
     * @param extraData Protocol-specific data (e.g., route encoding).
     * @param deadline Transaction deadline timestamp.
     * @return amountOut Actual output amount received.
     */
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
        address adapter = _getAdapter(protocolId);

        // Transfer input tokens from user to adapter
        if (tokenIn == address(0)) {
            // Native ETH: forward msg.value
            amountOut = IProtocolAdapter(adapter).swap{value: msg.value}(
                tokenIn, tokenOut, amountIn, amountOutMin, msg.sender, extraData
            );
        } else {
            // ERC20: pull from user to adapter
            tokenIn.safeTransferFrom(msg.sender, adapter, amountIn);
            amountOut = IProtocolAdapter(adapter).swap(
                tokenIn, tokenOut, amountIn, amountOutMin, msg.sender, extraData
            );
        }

        if (amountOut < amountOutMin) revert InsufficientOutput();

        emit SwapExecuted(msg.sender, protocolId, tokenIn, tokenOut, amountIn, amountOut);
    }

    // ========== LIQUIDITY ==========

    /**
     * @notice Add liquidity to a pool through a registered protocol adapter.
     * @param protocolId Identifier for the protocol.
     * @param tokenA First token address.
     * @param tokenB Second token address.
     * @param stable Whether this is a stable or volatile pool.
     * @param amountADesired Desired amount of tokenA.
     * @param amountBDesired Desired amount of tokenB.
     * @param amountAMin Minimum acceptable tokenA amount.
     * @param amountBMin Minimum acceptable tokenB amount.
     * @param extraData Protocol-specific data.
     * @param deadline Transaction deadline timestamp.
     * @return liquidity Amount of LP tokens received.
     */
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
        address adapter = _getAdapter(protocolId);

        // Transfer tokens from user to adapter
        tokenA.safeTransferFrom(msg.sender, adapter, amountADesired);
        tokenB.safeTransferFrom(msg.sender, adapter, amountBDesired);

        liquidity = IProtocolAdapter(adapter).addLiquidity(
            tokenA, tokenB, stable, amountADesired, amountBDesired, amountAMin, amountBMin, msg.sender, extraData
        );

        emit LiquidityAdded(msg.sender, protocolId, tokenA, tokenB, stable, liquidity);
    }

    /**
     * @notice Remove liquidity from a pool through a registered protocol adapter.
     * @param protocolId Identifier for the protocol.
     * @param tokenA First token address.
     * @param tokenB Second token address.
     * @param stable Whether this is a stable or volatile pool.
     * @param liquidity Amount of LP tokens to burn.
     * @param amountAMin Minimum acceptable tokenA amount.
     * @param amountBMin Minimum acceptable tokenB amount.
     * @param extraData Protocol-specific data.
     * @param deadline Transaction deadline timestamp.
     * @return amountA Actual tokenA received.
     * @return amountB Actual tokenB received.
     */
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
        address adapter = _getAdapter(protocolId);

        // Transfer LP tokens from user to adapter
        address pool = abi.decode(extraData, (address));
        pool.safeTransferFrom(msg.sender, adapter, liquidity);

        (amountA, amountB) = IProtocolAdapter(adapter).removeLiquidity(
            tokenA, tokenB, stable, liquidity, amountAMin, amountBMin, msg.sender, extraData
        );

        emit LiquidityRemoved(msg.sender, protocolId, tokenA, tokenB, stable, amountA, amountB);
    }

    // ========== STAKING ==========

    /**
     * @notice Stake LP tokens in a gauge/farm through a registered protocol adapter.
     * @param protocolId Identifier for the protocol.
     * @param lpToken Address of the LP token to stake.
     * @param amount Amount of LP tokens to stake.
     * @param extraData Protocol-specific data (e.g., gauge address).
     */
    function executeStake(bytes32 protocolId, address lpToken, uint256 amount, bytes calldata extraData)
        external
        nonReentrant
    {
        if (amount == 0) revert InvalidAmount();
        address adapter = _getAdapter(protocolId);

        lpToken.safeTransferFrom(msg.sender, adapter, amount);
        IProtocolAdapter(adapter).stake(lpToken, amount, extraData);

        emit StakeExecuted(msg.sender, protocolId, lpToken, amount);
    }

    /**
     * @notice Unstake LP tokens from a gauge/farm through a registered protocol adapter.
     * @param protocolId Identifier for the protocol.
     * @param lpToken Address of the LP token to unstake.
     * @param amount Amount of LP tokens to unstake.
     * @param extraData Protocol-specific data (e.g., gauge address).
     */
    function executeUnstake(bytes32 protocolId, address lpToken, uint256 amount, bytes calldata extraData)
        external
        nonReentrant
    {
        if (amount == 0) revert InvalidAmount();
        address adapter = _getAdapter(protocolId);

        IProtocolAdapter(adapter).unstake(lpToken, amount, extraData);

        emit UnstakeExecuted(msg.sender, protocolId, lpToken, amount);
    }

    // ========== ADMIN ==========

    /**
     * @notice Register a new protocol adapter.
     * @param protocolId Identifier for the protocol (e.g., keccak256("aerodrome")).
     * @param adapter Address of the adapter contract.
     */
    function registerAdapter(bytes32 protocolId, address adapter) external onlyOwner {
        if (adapter == address(0)) revert ZeroAddress();
        adapters[protocolId] = adapter;
        emit AdapterRegistered(protocolId, adapter);
    }

    /**
     * @notice Remove a registered protocol adapter.
     * @param protocolId Identifier for the protocol.
     */
    function removeAdapter(bytes32 protocolId) external onlyOwner {
        address old = adapters[protocolId];
        delete adapters[protocolId];
        emit AdapterRemoved(protocolId, old);
    }

    /**
     * @notice Transfer ownership of the contract.
     * @param newOwner Address of the new owner.
     */
    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert ZeroAddress();
        owner = newOwner;
    }

    /**
     * @notice Withdraw any stuck ETH from the contract.
     */
    function emergencyWithdraw() external onlyOwner {
        (bool success,) = owner.call{value: address(this).balance}("");
        if (!success) revert TransferFailed();
    }

    /**
     * @notice Withdraw any stuck ERC20 tokens from the contract.
     * @param token Address of the ERC20 token.
     */
    function emergencyWithdrawERC20(address token) external onlyOwner {
        uint256 balance = IERC20(token).balanceOf(address(this));
        token.safeTransfer(owner, balance);
    }

    // ========== INTERNAL ==========

    function _getAdapter(bytes32 protocolId) internal view returns (address adapter) {
        adapter = adapters[protocolId];
        if (adapter == address(0)) revert AdapterNotRegistered();
    }

    // ========== FALLBACK ==========

    receive() external payable {}
}
