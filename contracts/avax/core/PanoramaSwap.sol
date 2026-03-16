// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ITraderJoeRouter} from "../interfaces/ITraderJoeRouter.sol";

/// @title PanoramaSwap
/// @notice Swap router wrapper for Trader Joe V1 on Avalanche C-Chain.
///         Acts as the entry point for all swaps — every call generates a
///         transaction through this contract, burning AVAX as gas.
/// @dev Router: 0x60aE616a2155Ee3d9A68541Ba4544862310933d4
///      WAVAX:  0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7
contract PanoramaSwap is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ─── Immutables ───────────────────────────────────────────────────────

    ITraderJoeRouter public immutable router;
    address public immutable WAVAX;

    // ─── Events ───────────────────────────────────────────────────────────

    event SwapExecuted(
        address indexed user,
        address indexed tokenIn,
        address indexed tokenOut,
        uint256 amountIn,
        uint256 amountOut
    );

    // ─── Errors ───────────────────────────────────────────────────────────

    error InvalidPath();
    error ZeroAmount();
    error DeadlineExpired();

    // ─── Constructor ──────────────────────────────────────────────────────

    /// @param _router Trader Joe V1 router address
    constructor(address _router) Ownable(msg.sender) {
        router = ITraderJoeRouter(_router);
        WAVAX = ITraderJoeRouter(_router).WAVAX();
    }

    // ─── Swap Functions ───────────────────────────────────────────────────

    /// @notice Swap exact ERC20 → ERC20
    /// @param amountIn Exact input amount
    /// @param amountOutMin Minimum output amount (slippage protection)
    /// @param path Token swap path (e.g. [USDC, WAVAX, USDT])
    /// @param deadline Unix timestamp after which the tx reverts
    /// @return amountOut Actual output amount received
    function swapTokensForTokens(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        uint256 deadline
    ) external nonReentrant returns (uint256 amountOut) {
        if (path.length < 2) revert InvalidPath();
        if (amountIn == 0) revert ZeroAmount();
        if (block.timestamp > deadline) revert DeadlineExpired();

        IERC20(path[0]).safeTransferFrom(msg.sender, address(this), amountIn);
        IERC20(path[0]).forceApprove(address(router), amountIn);

        uint256[] memory amounts = router.swapExactTokensForTokens(amountIn, amountOutMin, path, msg.sender, deadline);

        amountOut = amounts[amounts.length - 1];
        emit SwapExecuted(msg.sender, path[0], path[path.length - 1], amountIn, amountOut);
    }

    /// @notice Swap exact AVAX → ERC20
    /// @param amountOutMin Minimum output amount (slippage protection)
    /// @param path Token swap path — must start with WAVAX
    /// @param deadline Unix timestamp after which the tx reverts
    /// @return amountOut Actual output amount received
    function swapAVAXForTokens(uint256 amountOutMin, address[] calldata path, uint256 deadline)
        external
        payable
        nonReentrant
        returns (uint256 amountOut)
    {
        if (path.length < 2) revert InvalidPath();
        if (path[0] != WAVAX) revert InvalidPath();
        if (msg.value == 0) revert ZeroAmount();
        if (block.timestamp > deadline) revert DeadlineExpired();

        uint256[] memory amounts =
            router.swapExactAVAXForTokens{value: msg.value}(amountOutMin, path, msg.sender, deadline);

        amountOut = amounts[amounts.length - 1];
        emit SwapExecuted(msg.sender, WAVAX, path[path.length - 1], msg.value, amountOut);
    }

    /// @notice Swap exact ERC20 → AVAX
    /// @param amountIn Exact input amount
    /// @param amountOutMin Minimum AVAX output (slippage protection)
    /// @param path Token swap path — must end with WAVAX
    /// @param deadline Unix timestamp after which the tx reverts
    /// @return amountOut Actual AVAX amount received
    function swapTokensForAVAX(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        uint256 deadline
    ) external nonReentrant returns (uint256 amountOut) {
        if (path.length < 2) revert InvalidPath();
        if (path[path.length - 1] != WAVAX) revert InvalidPath();
        if (amountIn == 0) revert ZeroAmount();
        if (block.timestamp > deadline) revert DeadlineExpired();

        IERC20(path[0]).safeTransferFrom(msg.sender, address(this), amountIn);
        IERC20(path[0]).forceApprove(address(router), amountIn);

        uint256[] memory amounts =
            router.swapExactTokensForAVAX(amountIn, amountOutMin, path, msg.sender, deadline);

        amountOut = amounts[amounts.length - 1];
        emit SwapExecuted(msg.sender, path[0], WAVAX, amountIn, amountOut);
    }

    // ─── View Functions ───────────────────────────────────────────────────

    /// @notice Returns expected output amounts for a swap path
    /// @param amountIn Input token amount
    /// @param path Token swap path
    function getAmountsOut(uint256 amountIn, address[] calldata path)
        external
        view
        returns (uint256[] memory amounts)
    {
        return router.getAmountsOut(amountIn, path);
    }

    // ─── Fallback ─────────────────────────────────────────────────────────

    receive() external payable {}
}
