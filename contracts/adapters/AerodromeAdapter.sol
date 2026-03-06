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
 * @dev Translates generic IProtocolAdapter calls into Aerodrome-specific interactions.
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
     * @dev extraData encodes (bool stable) indicating pool type.
     *      If tokenIn is address(0), swaps native ETH.
     *      If tokenOut is address(0), swaps to native ETH.
     */
    function swap(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 amountOutMin,
        address recipient,
        bytes calldata extraData
    ) external payable onlyExecutor returns (uint256 amountOut) {
        bool stable = abi.decode(extraData, (bool));

        // Build route
        IAerodromeRouter.Route[] memory routes = new IAerodromeRouter.Route[](1);
        address routeFrom = tokenIn == address(0) ? weth : tokenIn;
        address routeTo = tokenOut == address(0) ? weth : tokenOut;
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

        amountOut = amounts[amounts.length - 1];
    }

    // ========== LIQUIDITY ==========

    /**
     * @notice Add liquidity to an Aerodrome pool.
     * @dev Returns LP tokens to the recipient.
     */
    function addLiquidity(
        address tokenA,
        address tokenB,
        bool stable,
        uint256 amountADesired,
        uint256 amountBDesired,
        uint256 amountAMin,
        uint256 amountBMin,
        address recipient,
        bytes calldata /* extraData */
    ) external payable onlyExecutor returns (uint256 liquidity) {
        _approveRouter(tokenA, amountADesired);
        _approveRouter(tokenB, amountBDesired);

        (uint256 amountA, uint256 amountB, uint256 lp) = router.addLiquidity(
            tokenA, tokenB, stable, amountADesired, amountBDesired, amountAMin, amountBMin, recipient, block.timestamp
        );
        liquidity = lp;

        // Refund unused tokens
        _refundIfExcess(tokenA, amountADesired, amountA, recipient);
        _refundIfExcess(tokenB, amountBDesired, amountB, recipient);
    }

    /**
     * @notice Remove liquidity from an Aerodrome pool.
     * @dev extraData encodes (address pool) - the LP token address.
     */
    function removeLiquidity(
        address tokenA,
        address tokenB,
        bool stable,
        uint256 liquidity,
        uint256 amountAMin,
        uint256 amountBMin,
        address recipient,
        bytes calldata extraData
    ) external payable onlyExecutor returns (uint256 amountA, uint256 amountB) {
        address pool = abi.decode(extraData, (address));
        _approve(pool, address(router), liquidity);

        uint256 deadline = block.timestamp;

        (amountA, amountB) =
            router.removeLiquidity(tokenA, tokenB, stable, liquidity, amountAMin, amountBMin, recipient, deadline);
    }

    // ========== STAKING ==========

    /**
     * @notice Stake LP tokens in the corresponding Aerodrome gauge.
     * @dev extraData encodes (address gauge). If gauge is address(0), it is looked up via Voter.
     */
    function stake(address lpToken, uint256 amount, bytes calldata extraData) external onlyExecutor returns (bool) {
        address gauge = _resolveGauge(lpToken, extraData);
        _approve(lpToken, gauge, amount);
        IAerodromeGauge(gauge).deposit(amount, msg.sender);
        return true;
    }

    /**
     * @notice Unstake LP tokens from an Aerodrome gauge.
     * @dev extraData encodes (address gauge). If gauge is address(0), it is looked up via Voter.
     *      Note: The user must call this from the executor, which calls the gauge.
     *      Gauge withdrawals send LP tokens back to msg.sender (this adapter),
     *      so we forward them to the executor, which handles returning them to the user.
     */
    function unstake(address lpToken, uint256 amount, bytes calldata extraData) external onlyExecutor returns (bool) {
        address gauge = _resolveGauge(lpToken, extraData);
        IAerodromeGauge(gauge).withdraw(amount);
        // Forward unstaked LP tokens to executor (which returns them to user)
        lpToken.safeTransfer(executor, amount);
        return true;
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

    function _resolveGauge(address lpToken, bytes calldata extraData) internal view returns (address gauge) {
        gauge = abi.decode(extraData, (address));
        if (gauge == address(0)) {
            gauge = voter.gauges(lpToken);
        }
        if (gauge == address(0)) revert NoGauge();
    }

    // ========== FALLBACK ==========

    receive() external payable {}
}
