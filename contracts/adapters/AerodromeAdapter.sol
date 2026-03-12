// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IProtocolAdapter} from "../interfaces/IProtocolAdapter.sol";
import {AdapterSelectors} from "../libraries/AdapterSelectors.sol";
import {IAerodromeRouter} from "../interfaces/IAerodromeRouter.sol";
import {IAerodromeGauge, IAerodromeVoter} from "../interfaces/IAerodromeGauge.sol";
import {IERC20} from "../interfaces/IERC20.sol";
import {SafeTransferLib} from "../libraries/SafeTransferLib.sol";

/**
 * @title AerodromeAdapter
 * @notice Protocol adapter for Aerodrome Finance on Base.
 * @dev Implements IProtocolAdapter with a single execute() dispatcher.
 *
 *      Aerodrome contracts on Base mainnet:
 *      - Router2: 0xcF77a3Ba9A5CA399B7c97c74d54e5b1Beb874E43
 *      - DefaultFactory: 0x420DD381b31aEf6683db6B902084cB0FFECe40Da
 *      - Voter: 0x16613524e02ad97eDfeF371bC883F2F5d6C480A5
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
    error SwapFailed();
    error LiquidityFailed();
    error StakeFailed();
    error UnstakeFailed();
    error NoGauge();
    error UnknownSelector(bytes4 selector);

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

    // ========== EXECUTE DISPATCHER ==========

    /**
     * @notice Dispatch an operation to the appropriate internal handler.
     * @dev Only callable by the PanoramaExecutor. The executor has already transferred
     *      any required input tokens into this adapter clone before calling execute().
     */
    function execute(bytes4 selector, bytes calldata data)
        external payable onlyExecutor returns (bytes memory)
    {
        if (selector == AdapterSelectors.SWAP)             return _executeSwap(data);
        if (selector == AdapterSelectors.ADD_LIQUIDITY)    return _executeAddLiquidity(data);
        if (selector == AdapterSelectors.REMOVE_LIQUIDITY) return _executeRemoveLiquidity(data);
        if (selector == AdapterSelectors.STAKE)            return _executeStake(data);
        if (selector == AdapterSelectors.UNSTAKE)          return _executeUnstake(data);
        if (selector == AdapterSelectors.CLAIM_REWARDS)    return _executeClaimRewards(data);
        revert UnknownSelector(selector);
    }

    // ========== SWAP ==========

    /**
     * @notice Execute a swap through Aerodrome Router2.
     * @dev data = abi.encode(tokenIn, tokenOut, amountIn, amountOutMin, recipient, stable)
     *      If tokenIn is address(0), swaps native ETH (msg.value).
     *      If tokenOut is address(0), swaps to native ETH.
     */
    function _executeSwap(bytes calldata data) internal returns (bytes memory) {
        (
            address tokenIn,
            address tokenOut,
            uint256 amountIn,
            uint256 amountOutMin,
            address recipient,
            bool stable
        ) = abi.decode(data, (address, address, uint256, uint256, address, bool));

        if (amountIn == 0) revert SwapFailed();

        // Build route
        IAerodromeRouter.Route[] memory routes = new IAerodromeRouter.Route[](1);
        address routeFrom = tokenIn == address(0) ? weth : tokenIn;
        address routeTo   = tokenOut == address(0) ? weth : tokenOut;
        routes[0] = IAerodromeRouter.Route({from: routeFrom, to: routeTo, stable: stable, factory: factory});

        uint256 deadline = block.timestamp;
        uint256[] memory amounts;

        if (tokenIn == address(0)) {
            // ETH -> Token
            amounts = router.swapExactETHForTokens{value: amountIn}(amountOutMin, routes, recipient, deadline);
        } else if (tokenOut == address(0)) {
            // Token -> ETH
            _approveRouter(tokenIn, amountIn);
            amounts = router.swapExactTokensForETH(amountIn, amountOutMin, routes, recipient, deadline);
        } else {
            // Token -> Token
            _approveRouter(tokenIn, amountIn);
            amounts = router.swapExactTokensForTokens(amountIn, amountOutMin, routes, recipient, deadline);
        }

        uint256 amountOut = amounts[amounts.length - 1];
        return abi.encode(amountOut);
    }

    // ========== LIQUIDITY ==========

    /**
     * @notice Add liquidity to an Aerodrome pool.
     * @dev data = abi.encode(tokenA, tokenB, stable, amountADesired, amountBDesired,
     *                         amountAMin, amountBMin, recipient)
     *      Returns LP tokens to the recipient.
     */
    function _executeAddLiquidity(bytes calldata data) internal returns (bytes memory) {
        (
            address tokenA,
            address tokenB,
            bool stable,
            uint256 amountADesired,
            uint256 amountBDesired,
            uint256 amountAMin,
            uint256 amountBMin,
            address recipient
        ) = abi.decode(data, (address, address, bool, uint256, uint256, uint256, uint256, address));

        _approveRouter(tokenA, amountADesired);
        _approveRouter(tokenB, amountBDesired);

        (uint256 amountA, uint256 amountB, uint256 liquidity) = router.addLiquidity(
            tokenA, tokenB, stable, amountADesired, amountBDesired, amountAMin, amountBMin, recipient, block.timestamp
        );

        // Refund unused tokens
        _refundIfExcess(tokenA, amountADesired, amountA, recipient);
        _refundIfExcess(tokenB, amountBDesired, amountB, recipient);

        return abi.encode(liquidity);
    }

    /**
     * @notice Remove liquidity from an Aerodrome pool.
     * @dev data = abi.encode(tokenA, tokenB, stable, liquidity, amountAMin, amountBMin, recipient, pool)
     *      The LP token (pool address) must already be in this adapter clone (transferred by executor).
     */
    function _executeRemoveLiquidity(bytes calldata data) internal returns (bytes memory) {
        (
            address tokenA,
            address tokenB,
            bool stable,
            uint256 liquidity,
            uint256 amountAMin,
            uint256 amountBMin,
            address recipient,
            address pool
        ) = abi.decode(data, (address, address, bool, uint256, uint256, uint256, address, address));

        _approve(pool, address(router), liquidity);

        (uint256 amountA, uint256 amountB) = router.removeLiquidity(
            tokenA, tokenB, stable, liquidity, amountAMin, amountBMin, recipient, block.timestamp
        );

        return abi.encode(amountA, amountB);
    }

    // ========== STAKING ==========

    /**
     * @notice Stake LP tokens in the corresponding Aerodrome gauge.
     * @dev data = abi.encode(lpToken, amount, gauge)
     *      The LP tokens must already be in this adapter clone (transferred by executor).
     *      If gauge is address(0), it is looked up via Voter.
     */
    function _executeStake(bytes calldata data) internal returns (bytes memory) {
        (address lpToken, uint256 amount, address gauge) = abi.decode(data, (address, uint256, address));

        if (gauge == address(0)) {
            gauge = voter.gauges(lpToken);
        }
        if (gauge == address(0)) revert NoGauge();

        _approve(lpToken, gauge, amount);
        IAerodromeGauge(gauge).deposit(amount);

        return abi.encode(true);
    }

    /**
     * @notice Unstake LP tokens from an Aerodrome gauge and send to recipient.
     * @dev data = abi.encode(lpToken, amount, gauge, recipient)
     *      Gauge withdrawal sends LP tokens back to this adapter (msg.sender of withdraw).
     *      The adapter then forwards LP tokens directly to the recipient.
     *      If gauge is address(0), it is looked up via Voter.
     */
    function _executeUnstake(bytes calldata data) internal returns (bytes memory) {
        (address lpToken, uint256 amount, address gauge, address recipient) =
            abi.decode(data, (address, uint256, address, address));

        if (gauge == address(0)) {
            gauge = voter.gauges(lpToken);
        }
        if (gauge == address(0)) revert NoGauge();

        IAerodromeGauge(gauge).withdraw(amount);
        lpToken.safeTransfer(recipient, amount);

        return abi.encode(true);
    }

    // ========== CLAIM REWARDS ==========

    /**
     * @notice Claim pending AERO rewards from a gauge and forward to recipient.
     * @dev data = abi.encode(lpToken, recipient, gauge)
     *      The adapter is the depositor in the gauge, so only it can claim.
     *      If gauge is address(0), it is looked up via Voter.
     */
    function _executeClaimRewards(bytes calldata data) internal returns (bytes memory) {
        (address lpToken, address recipient, address gauge) = abi.decode(data, (address, address, address));

        if (gauge == address(0)) {
            gauge = voter.gauges(lpToken);
        }
        if (gauge == address(0)) revert NoGauge();

        address rewardToken = IAerodromeGauge(gauge).rewardToken();

        uint256 balBefore = IERC20(rewardToken).balanceOf(address(this));
        IAerodromeGauge(gauge).getReward(address(this));
        uint256 balAfter = IERC20(rewardToken).balanceOf(address(this));

        uint256 rewardAmount = balAfter - balBefore;
        if (rewardAmount > 0) {
            rewardToken.safeTransfer(recipient, rewardAmount);
        }

        return abi.encode(rewardAmount);
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

    // ========== FALLBACK ==========

    receive() external payable {}
}
