// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IProtocolAdapter} from "../interfaces/IProtocolAdapter.sol";
import {IAerodromeRouter} from "../interfaces/IAerodromeRouter.sol";
import {IAerodromeGauge, IAerodromeVoter} from "../interfaces/IAerodromeGauge.sol";
import {IERC20} from "../interfaces/IERC20.sol";
import {SafeTransferLib} from "../libraries/SafeTransferLib.sol";

/**
 * @title AerodromeAdapter
 * @notice Protocol adapter for Aerodrome Finance on Base.
 * @dev Implements IProtocolAdapter with flat typed parameters — no `bytes extraData`
 *      indirection. Called via low-level dispatch from PanoramaExecutor.execute().
 *
 *      Aerodrome contracts on Base mainnet:
 *      - Router2:        0xcF77a3Ba9A5CA399B7c97c74d54e5b1Beb874E43
 *      - DefaultFactory: 0x420DD381b31aEf6683db6B902084cB0FFECe40Da
 *      - Voter:          0x16613524e02ad97eDfeF371bC883F2F5d6C480A5
 */
contract AerodromeAdapter is IProtocolAdapter {
    using SafeTransferLib for address;

    // ========== STATE ==========

    IAerodromeRouter public immutable router;
    IAerodromeVoter public immutable voter;
    address public immutable factory;
    address public immutable weth;
    address public immutable executor;

    // ========== ERRORS ==========

    error OnlyExecutor();
    error NoGauge();

    // ========== MODIFIERS ==========

    modifier onlyExecutor() {
        if (msg.sender != executor) revert OnlyExecutor();
        _;
    }

    // ========== CONSTRUCTOR ==========

    constructor(address _router, address _voter, address _executor) {
        router = IAerodromeRouter(_router);
        voter = IAerodromeVoter(_voter);
        factory = router.defaultFactory();
        weth = router.weth();
        executor = _executor;
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
        address routeTo   = tokenOut == address(0) ? weth : tokenOut;
        routes[0] = IAerodromeRouter.Route({from: routeFrom, to: routeTo, stable: stable, factory: factory});

        // Use a 5-minute buffer from the current block to allow tx propagation
        // while still providing meaningful deadline protection against stale txs.
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
            tokenA, tokenB, stable,
            amountADesired, amountBDesired,
            amountAMin, amountBMin,
            recipient, block.timestamp
        );
        liquidity = lp;

        // Refund unused tokens directly to recipient
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
        (amountA, amountB) = router.removeLiquidity(
            tokenA, tokenB, stable,
            liquidity, amountAMin, amountBMin,
            recipient, block.timestamp
        );
    }

    // ========== STAKING ==========

    /// @notice Stake LP tokens in the specified Aerodrome gauge.
    function stake(
        address lpToken,
        uint256 amount,
        address gauge
    ) external onlyExecutor returns (bool) {
        address resolvedGauge = _resolveGauge(lpToken, gauge);
        _approve(lpToken, resolvedGauge, amount);
        IAerodromeGauge(resolvedGauge).deposit(amount);
        return true;
    }

    /**
     * @notice Unstake LP tokens from an Aerodrome gauge and forward to recipient.
     * @dev The adapter is the depositor in the gauge. After withdrawal, LP tokens
     *      are forwarded directly to recipient — no intermediate executor hop needed.
     */
    function unstake(
        address lpToken,
        uint256 amount,
        address gauge,
        address recipient
    ) external onlyExecutor returns (bool) {
        address resolvedGauge = _resolveGauge(lpToken, gauge);
        IAerodromeGauge(resolvedGauge).withdraw(amount);
        lpToken.safeTransfer(recipient, amount);
        return true;
    }

    // ========== CLAIM REWARDS ==========

    /// @notice Claim pending AERO rewards from a gauge and forward to recipient.
    function claimRewards(
        address lpToken,
        address recipient,
        address gauge
    ) external onlyExecutor returns (uint256 rewardAmount) {
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
