// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Initializable} from "@openzeppelin/contracts/proxy/utils/Initializable.sol";
import {ITraderJoeRouter} from "../interfaces/ITraderJoeRouter.sol";

/**
 * @title TraderJoeAdapter
 * @notice Proxy-compatible adapter for Trader Joe V1 swaps on Avalanche.
 * @dev Follows the same BeaconProxy + PanoramaExecutorV2 pattern as AerodromeAdapterV2.
 *
 *      Replaces PanoramaSwap (standalone contract) with an adapter that:
 *        - Is deployed behind an UpgradeableBeacon (upgradeable)
 *        - Each user gets their own BeaconProxy (isolated storage)
 *        - Only the executor can call action functions (onlyExecutor)
 *        - Uses Initializable instead of constructor
 *
 *      Trader Joe V1 Router: 0x60aE616a2155Ee3d9A68541Ba4544862310933d4
 *      WAVAX:                0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7
 *
 *      Storage layout:
 *        slot 0: router (ITraderJoeRouter)
 *        slot 1: wavax (address)
 *        slot 2: executor (address)
 *        slots 3-52: __gap (50 reserved)
 */
contract TraderJoeAdapter is Initializable {
    using SafeERC20 for IERC20;

    // ========== STORAGE ==========

    ITraderJoeRouter public router;
    address public wavax;
    address public executor;

    // ========== STORAGE GAP ==========

    uint256[50] private __gap;

    // ========== ERRORS ==========

    error OnlyExecutor();
    error InvalidPath();
    error ZeroAmount();

    // ========== MODIFIERS ==========

    modifier onlyExecutor() {
        if (msg.sender != executor) revert OnlyExecutor();
        _;
    }

    // ========== INITIALIZER ==========

    /**
     * @notice Initialize the adapter proxy.
     * @dev Called by PanoramaExecutorV2 when creating the BeaconProxy.
     *      initArgs = abi.encode(routerAddress).
     *
     * @param _executor  The PanoramaExecutorV2 contract address.
     * @param _initArgs  ABI-encoded: (address router).
     */
    function initializeFull(address _executor, bytes calldata _initArgs) external initializer {
        executor = _executor;
        address _router = abi.decode(_initArgs, (address));
        router = ITraderJoeRouter(_router);
        wavax = router.WAVAX();
    }

    // ========== SWAP ==========

    /**
     * @notice Swap exact ERC20 → ERC20 through Trader Joe V1.
     * @param tokenIn      Input token address.
     * @param tokenOut     Output token address.
     * @param amountIn     Exact input amount.
     * @param amountOutMin Minimum output (slippage protection).
     * @param recipient    Address to receive output tokens.
     * @return amountOut   Actual output amount.
     */
    function swap(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 amountOutMin,
        address recipient
    ) external payable onlyExecutor returns (uint256 amountOut) {
        if (amountIn == 0) revert ZeroAmount();

        // Build path — route through WAVAX if neither token is native/WAVAX
        address[] memory path;
        address resolvedIn = tokenIn == address(0) ? wavax : tokenIn;
        address resolvedOut = tokenOut == address(0) ? wavax : tokenOut;

        if (resolvedIn == wavax || resolvedOut == wavax) {
            path = new address[](2);
            path[0] = resolvedIn;
            path[1] = resolvedOut;
        } else {
            path = new address[](3);
            path[0] = resolvedIn;
            path[1] = wavax;
            path[2] = resolvedOut;
        }

        uint256 deadline = block.timestamp + 300;
        uint256[] memory amounts;

        if (tokenIn == address(0)) {
            // AVAX → Token
            amounts = router.swapExactAVAXForTokens{value: amountIn}(amountOutMin, path, recipient, deadline);
        } else if (tokenOut == address(0)) {
            // Token → AVAX
            IERC20(tokenIn).forceApprove(address(router), amountIn);
            amounts = router.swapExactTokensForAVAX(amountIn, amountOutMin, path, recipient, deadline);
        } else {
            // Token → Token
            IERC20(tokenIn).forceApprove(address(router), amountIn);
            amounts = router.swapExactTokensForTokens(amountIn, amountOutMin, path, recipient, deadline);
        }

        amountOut = amounts[amounts.length - 1];
    }

    /**
     * @notice Swap with explicit path for multi-hop routes.
     * @param amountIn     Exact input amount.
     * @param amountOutMin Minimum output (slippage protection).
     * @param path         Token swap path (e.g. [USDC, WAVAX, USDT]).
     * @param recipient    Address to receive output tokens.
     * @return amountOut   Actual output amount.
     */
    function swapWithPath(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        address recipient
    ) external payable onlyExecutor returns (uint256 amountOut) {
        if (path.length < 2) revert InvalidPath();
        if (amountIn == 0) revert ZeroAmount();

        uint256 deadline = block.timestamp + 300;
        uint256[] memory amounts;

        if (path[0] == wavax && msg.value > 0) {
            amounts = router.swapExactAVAXForTokens{value: amountIn}(amountOutMin, path, recipient, deadline);
        } else if (path[path.length - 1] == wavax) {
            IERC20(path[0]).forceApprove(address(router), amountIn);
            amounts = router.swapExactTokensForAVAX(amountIn, amountOutMin, path, recipient, deadline);
        } else {
            IERC20(path[0]).forceApprove(address(router), amountIn);
            amounts = router.swapExactTokensForTokens(amountIn, amountOutMin, path, recipient, deadline);
        }

        amountOut = amounts[amounts.length - 1];
    }

    // ========== VIEW ==========

    /// @notice Preview output amounts for a swap path.
    function getAmountsOut(uint256 amountIn, address[] calldata path) external view returns (uint256[] memory) {
        return router.getAmountsOut(amountIn, path);
    }

    // ========== FALLBACK ==========

    receive() external payable {}
}
