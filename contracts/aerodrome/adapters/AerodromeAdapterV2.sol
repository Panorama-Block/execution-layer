// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IProtocolAdapter} from "../interfaces/IProtocolAdapter.sol";
import {IAerodromeRouter} from "../interfaces/IAerodromeRouter.sol";
import {IAerodromeGauge, IAerodromeVoter} from "../interfaces/IAerodromeGauge.sol";
import {IERC20} from "../interfaces/IERC20.sol";
import {SafeTransferLib} from "../libraries/SafeTransferLib.sol";
import {Initializable} from "@openzeppelin/contracts/proxy/utils/Initializable.sol";
import {ISwapAdapter} from "../../interfaces/ISwapAdapter.sol";
import {ILPAdapter} from "../../interfaces/ILPAdapter.sol";

/**
 * @title AerodromeAdapterV2
 * @notice Proxy-compatible protocol adapter for Aerodrome Finance on Base.
 * @dev Upgrade from V1:
 *      - Replaces `immutable` variables with regular storage set via `initialize()`
 *      - Inherits `Initializable` from OpenZeppelin (prevents double-init)
 *      - Adds `__gap` for future storage layout stability
 *      - No constructor logic — all setup in initializer
 *
 *      Each user gets their own BeaconProxy pointing to this implementation via
 *      an UpgradeableBeacon. The executor creates the proxy and calls initialize().
 *
 *      Storage layout (slots must remain stable across upgrades):
 *        slot 0: router (IAerodromeRouter)
 *        slot 1: voter (IAerodromeVoter)
 *        slot 2: factory (address)
 *        slot 3: weth (address)
 *        slot 4: executor (address)
 *        slots 5-54: __gap (50 reserved slots for future use)
 */
contract AerodromeAdapterV2 is IProtocolAdapter, ISwapAdapter, ILPAdapter, Initializable {
    using SafeTransferLib for address;

    // ========== STORAGE (was immutable in V1) ==========

    IAerodromeRouter public router;
    IAerodromeVoter public voter;
    address public factory;
    address public weth;
    address public executor;

    // ========== STORAGE GAP ==========

    /// @dev Reserved storage slots for future upgrades.
    ///      When adding new state variables in V3, reduce __gap size accordingly.
    ///      Example: adding 2 new slots → change to uint256[48].
    uint256[50] private __gap;

    // ========== ERRORS ==========

    error OnlyExecutor();
    error NoGauge();

    // ========== MODIFIERS ==========

    modifier onlyExecutor() {
        if (msg.sender != executor) revert OnlyExecutor();
        _;
    }

    // ========== INITIALIZER (replaces constructor) ==========

    /**
     * @notice Initialize the adapter proxy with executor + protocol-specific config.
     * @dev Called once by PanoramaExecutorV2 when creating the BeaconProxy.
     *      The `initializer` modifier from OpenZeppelin prevents re-initialization.
     *
     *      The executor stores protocol-specific initArgs (ABI-encoded router, voter)
     *      at registration time. When creating a proxy, it calls:
     *        initializeFull(executorAddress, initArgs)
     *
     *      For Aerodrome, initArgs = abi.encode(routerAddress, voterAddress).
     *
     * @param _executor  The PanoramaExecutorV2 contract address.
     * @param _initArgs  ABI-encoded protocol config: (address router, address voter).
     */
    function initializeFull(address _executor, bytes calldata _initArgs) external initializer {
        executor = _executor;
        (address _router, address _voter) = abi.decode(_initArgs, (address, address));
        router = IAerodromeRouter(_router);
        voter = IAerodromeVoter(_voter);
        factory = router.defaultFactory();
        weth = router.weth();
    }

    // ========== SWAP ==========

    /**
     * @notice Execute a swap through Aerodrome Router2.
     * @param stable Whether to use a stable (correlated) or volatile pool.
     */
    function swap(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 amountOutMin,
        address recipient,
        bool stable
    ) external payable onlyExecutor returns (uint256 amountOut) {
        IAerodromeRouter.Route[] memory routes = new IAerodromeRouter.Route[](1);
        address routeFrom = tokenIn == address(0) ? weth : tokenIn;
        address routeTo = tokenOut == address(0) ? weth : tokenOut;
        routes[0] =
            IAerodromeRouter.Route({from: routeFrom, to: routeTo, stable: stable, factory: factory});

        uint256 deadline = block.timestamp + 300;
        uint256[] memory amounts;

        if (tokenIn == address(0)) {
            amounts = router.swapExactETHForTokens{value: amountIn}(amountOutMin, routes, recipient, deadline);
        } else if (tokenOut == address(0)) {
            _approveRouter(tokenIn, amountIn);
            amounts = router.swapExactTokensForETH(amountIn, amountOutMin, routes, recipient, deadline);
        } else {
            _approveRouter(tokenIn, amountIn);
            amounts = router.swapExactTokensForTokens(amountIn, amountOutMin, routes, recipient, deadline);
        }

        amountOut = amounts[amounts.length - 1];
    }

    // ========== LIQUIDITY ==========

    /// @notice Add liquidity to an Aerodrome pool. Refunds unused token amounts to recipient.
    function addLiquidity(
        address tokenA,
        address tokenB,
        bool stable,
        uint256 amountADesired,
        uint256 amountBDesired,
        uint256 amountAMin,
        uint256 amountBMin,
        address recipient
    ) external payable onlyExecutor returns (uint256 liquidity) {
        _approveRouter(tokenA, amountADesired);
        _approveRouter(tokenB, amountBDesired);

        (uint256 usedA, uint256 usedB, uint256 lp) = router.addLiquidity(
            tokenA, tokenB, stable, amountADesired, amountBDesired, amountAMin, amountBMin, recipient, block.timestamp
        );
        liquidity = lp;

        _refundIfExcess(tokenA, amountADesired, usedA, recipient);
        _refundIfExcess(tokenB, amountBDesired, usedB, recipient);
    }

    /**
     * @notice Remove liquidity from an Aerodrome pool.
     * @param pool LP token address — needed to approve the router to spend it.
     */
    function removeLiquidity(
        address tokenA,
        address tokenB,
        bool stable,
        uint256 liquidity,
        uint256 amountAMin,
        uint256 amountBMin,
        address recipient,
        address pool
    ) external onlyExecutor returns (uint256 amountA, uint256 amountB) {
        _approve(pool, address(router), liquidity);
        (amountA, amountB) =
            router.removeLiquidity(tokenA, tokenB, stable, liquidity, amountAMin, amountBMin, recipient, block.timestamp);
    }

    // ========== STAKING ==========

    /// @notice Stake LP tokens in the specified Aerodrome gauge.
    function stake(address lpToken, uint256 amount, address gauge) external onlyExecutor returns (bool) {
        address resolvedGauge = _resolveGauge(lpToken, gauge);
        _approve(lpToken, resolvedGauge, amount);
        IAerodromeGauge(resolvedGauge).deposit(amount);
        return true;
    }

    /**
     * @notice Unstake LP tokens from an Aerodrome gauge and forward to recipient.
     */
    function unstake(address lpToken, uint256 amount, address gauge, address recipient)
        external
        onlyExecutor
        returns (bool)
    {
        address resolvedGauge = _resolveGauge(lpToken, gauge);
        IAerodromeGauge(resolvedGauge).withdraw(amount);
        lpToken.safeTransfer(recipient, amount);
        return true;
    }

    // ========== CLAIM REWARDS ==========

    /// @notice Claim pending AERO rewards from a gauge and forward to recipient.
    function claimRewards(address lpToken, address recipient, address gauge)
        external
        onlyExecutor
        returns (uint256 rewardAmount)
    {
        address resolvedGauge = _resolveGauge(lpToken, gauge);
        address rewardToken = IAerodromeGauge(resolvedGauge).rewardToken();

        uint256 balBefore = IERC20(rewardToken).balanceOf(address(this));
        IAerodromeGauge(resolvedGauge).getReward(address(this));
        uint256 balAfter = IERC20(rewardToken).balanceOf(address(this));

        rewardAmount = balAfter - balBefore;
        if (rewardAmount > 0) {
            rewardToken.safeTransfer(recipient, rewardAmount);
        }
    }

    // ========== INTERNAL ==========

    function _approveRouter(address token, uint256 amount) internal {
        _approve(token, address(router), amount);
    }

    function _approve(address token, address spender, uint256 amount) internal {
        token.safeApprove(spender, 0);
        token.safeApprove(spender, amount);
    }

    function _refundIfExcess(address token, uint256 desired, uint256 used, address to) internal {
        if (desired > used) {
            token.safeTransfer(to, desired - used);
        }
    }

    /// @dev If gauge is address(0), looks it up via Voter. Reverts if not found.
    function _resolveGauge(address lpToken, address gauge) internal view returns (address) {
        if (gauge == address(0)) {
            gauge = voter.gauges(lpToken);
        }
        if (gauge == address(0)) revert NoGauge();
        return gauge;
    }

    // ========== FALLBACK ==========

    receive() external payable {}
}
