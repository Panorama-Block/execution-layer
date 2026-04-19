// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Initializable} from "@openzeppelin/contracts/proxy/utils/Initializable.sol";
import {ITraderJoeRouter} from "../interfaces/ITraderJoeRouter.sol";
import {ITraderJoeMasterChef} from "../interfaces/ITraderJoeMasterChef.sol";

/// @title TraderJoeAdapterV2
/// @notice Storage-safe upgrade of TraderJoeAdapter adding LP and Farm operations.
///
/// Storage layout (must never be reordered):
///   slot 0: router      (ITraderJoeRouter)   ← V1
///   slot 1: wavax       (address)             ← V1
///   slot 2: executor    (address)             ← V1
///   slot 3: masterChef  (ITraderJoeMasterChef)← V2, consumed from __gap
///   slot 4: joeToken    (address)             ← V2, consumed from __gap
///   slots 5–52: __gap[48]                     ← 50 - 2 new slots
///
/// Upgrade path:
///   1. beacon.upgradeTo(address(new TraderJoeAdapterV2()))
///   2. Call initializeV2(masterChefAddress) on each proxy (or via executor batch)
contract TraderJoeAdapterV2 is Initializable {
    using SafeERC20 for IERC20;

    // ── STORAGE V1 (immutable layout) ──────────────────────────────────────

    ITraderJoeRouter public router;   // slot 0
    address          public wavax;    // slot 1
    address          public executor; // slot 2

    // ── STORAGE V2 ──────────────────────────────────────────────────────────

    ITraderJoeMasterChef public masterChef; // slot 3
    address              public joeToken;   // slot 4

    // ── STORAGE GAP (48 = 50 - 2 new V2 slots) ──────────────────────────────

    uint256[48] private __gap;

    // ── ERRORS ───────────────────────────────────────────────────────────────

    error OnlyExecutor();
    error InvalidPath();
    error ZeroAmount();
    error ZeroLiquidity();
    error MasterChefNotInitialized();

    // ── MODIFIERS ────────────────────────────────────────────────────────────

    modifier onlyExecutor() {
        if (msg.sender != executor) revert OnlyExecutor();
        _;
    }

    // ── INITIALIZERS ────────────────────────────────────────────────────────

    /// @notice V1 initializer — preserved unchanged for BeaconProxy creation.
    /// @param _executor  PanoramaExecutorV2 address.
    /// @param _initArgs  abi.encode(address router).
    function initializeFull(address _executor, bytes calldata _initArgs) external initializer {
        executor = _executor;
        address _router = abi.decode(_initArgs, (address));
        router = ITraderJoeRouter(_router);
        wavax  = router.WAVAX();
    }

    /// @notice V2 reinitializer — called once per proxy after beacon upgrade.
    /// @param _masterChef  MasterChefJoeV3: 0x188bED1968b795d5c9022F6a0bb5931Ac4c18F00
    /// @param _joeToken    JOE token: 0x6e84a6216eA6dACC71eE8E6b0a5B7322EEbC0fDd
    ///                     Passed explicitly because MCV3 exposes JOE() (uppercase)
    ///                     while MCV2 uses joe() — avoid brittle version detection.
    function initializeV2(address _masterChef, address _joeToken) external reinitializer(2) {
        masterChef = ITraderJoeMasterChef(_masterChef);
        joeToken   = _joeToken;
    }

    // ══════════════════════════════════════════════════════════════════════════
    //  SWAP (V1 — preserved without modification)
    // ══════════════════════════════════════════════════════════════════════════

    /// @notice Swap exact ERC20 → ERC20 (or AVAX ↔ token) through TraderJoe V1.
    function swap(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 amountOutMin,
        address recipient
    ) external payable onlyExecutor returns (uint256 amountOut) {
        if (amountIn == 0) revert ZeroAmount();

        address resolvedIn  = tokenIn  == address(0) ? wavax : tokenIn;
        address resolvedOut = tokenOut == address(0) ? wavax : tokenOut;

        address[] memory path;
        if (resolvedIn == wavax || resolvedOut == wavax) {
            path    = new address[](2);
            path[0] = resolvedIn;
            path[1] = resolvedOut;
        } else {
            path    = new address[](3);
            path[0] = resolvedIn;
            path[1] = wavax;
            path[2] = resolvedOut;
        }

        uint256 deadline = block.timestamp + 300;
        uint256[] memory amounts;

        if (tokenIn == address(0)) {
            amounts = router.swapExactAVAXForTokens{value: amountIn}(amountOutMin, path, recipient, deadline);
        } else if (tokenOut == address(0)) {
            IERC20(tokenIn).forceApprove(address(router), amountIn);
            amounts = router.swapExactTokensForAVAX(amountIn, amountOutMin, path, recipient, deadline);
        } else {
            IERC20(tokenIn).forceApprove(address(router), amountIn);
            amounts = router.swapExactTokensForTokens(amountIn, amountOutMin, path, recipient, deadline);
        }

        amountOut = amounts[amounts.length - 1];
    }

    /// @notice Swap with explicit multi-hop path.
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

    // ══════════════════════════════════════════════════════════════════════════
    //  LP — ADD LIQUIDITY
    // ══════════════════════════════════════════════════════════════════════════

    /// @notice Add Token-Token liquidity to a TraderJoe V1 pool.
    /// @param tokenA          First token address.
    /// @param tokenB          Second token address.
    /// @param amountADesired  Max amount of tokenA to deposit.
    /// @param amountBDesired  Max amount of tokenB to deposit.
    /// @param amountAMin      Minimum tokenA accepted (slippage guard).
    /// @param amountBMin      Minimum tokenB accepted (slippage guard).
    /// @param recipient       Address to receive LP tokens and any unused dust.
    function addLiquidity(
        address tokenA,
        address tokenB,
        uint256 amountADesired,
        uint256 amountBDesired,
        uint256 amountAMin,
        uint256 amountBMin,
        address recipient
    ) external onlyExecutor returns (uint256 amountA, uint256 amountB, uint256 liquidity) {
        if (amountADesired == 0 || amountBDesired == 0) revert ZeroAmount();

        IERC20(tokenA).forceApprove(address(router), amountADesired);
        IERC20(tokenB).forceApprove(address(router), amountBDesired);

        (amountA, amountB, liquidity) = router.addLiquidity(
            tokenA,
            tokenB,
            amountADesired,
            amountBDesired,
            amountAMin,
            amountBMin,
            recipient,
            block.timestamp + 300
        );

        // Return unused token dust to recipient
        uint256 excessA = amountADesired - amountA;
        uint256 excessB = amountBDesired - amountB;
        if (excessA > 0) IERC20(tokenA).safeTransfer(recipient, excessA);
        if (excessB > 0) IERC20(tokenB).safeTransfer(recipient, excessB);
    }

    /// @notice Add Token-AVAX liquidity to a TraderJoe V1 pool.
    /// @param token               ERC-20 token address (the non-AVAX side).
    /// @param amountTokenDesired  Max amount of token to deposit.
    /// @param amountTokenMin      Minimum token amount accepted.
    /// @param amountAVAXMin       Minimum AVAX amount accepted.
    /// @param recipient           Address to receive LP tokens and dust.
    function addLiquidityAVAX(
        address token,
        uint256 amountTokenDesired,
        uint256 amountTokenMin,
        uint256 amountAVAXMin,
        address recipient
    ) external payable onlyExecutor returns (uint256 amountToken, uint256 amountAVAX, uint256 liquidity) {
        if (amountTokenDesired == 0 || msg.value == 0) revert ZeroAmount();

        IERC20(token).forceApprove(address(router), amountTokenDesired);

        (amountToken, amountAVAX, liquidity) = router.addLiquidityAVAX{value: msg.value}(
            token,
            amountTokenDesired,
            amountTokenMin,
            amountAVAXMin,
            recipient,
            block.timestamp + 300
        );

        uint256 excessToken = amountTokenDesired - amountToken;
        uint256 excessAVAX  = msg.value - amountAVAX;
        if (excessToken > 0) IERC20(token).safeTransfer(recipient, excessToken);
        if (excessAVAX  > 0) payable(recipient).transfer(excessAVAX);
    }

    // ══════════════════════════════════════════════════════════════════════════
    //  LP — REMOVE LIQUIDITY
    // ══════════════════════════════════════════════════════════════════════════

    /// @notice Remove Token-Token liquidity from a TraderJoe V1 pool.
    /// @param tokenA       First token address.
    /// @param tokenB       Second token address.
    /// @param pairAddress  LP token (pair) address — must match factory.getPair(tokenA,tokenB).
    /// @param liquidity    LP token amount to burn.
    /// @param amountAMin   Minimum tokenA to receive.
    /// @param amountBMin   Minimum tokenB to receive.
    /// @param recipient    Address to receive withdrawn tokens.
    function removeLiquidity(
        address tokenA,
        address tokenB,
        address pairAddress,
        uint256 liquidity,
        uint256 amountAMin,
        uint256 amountBMin,
        address recipient
    ) external onlyExecutor returns (uint256 amountA, uint256 amountB) {
        if (liquidity == 0) revert ZeroLiquidity();

        IERC20(pairAddress).forceApprove(address(router), liquidity);

        (amountA, amountB) = router.removeLiquidity(
            tokenA,
            tokenB,
            liquidity,
            amountAMin,
            amountBMin,
            recipient,
            block.timestamp + 300
        );
    }

    /// @notice Remove Token-AVAX liquidity from a TraderJoe V1 pool.
    /// @param token        ERC-20 token address (the non-AVAX side).
    /// @param pairAddress  LP token (pair) address.
    /// @param liquidity    LP token amount to burn.
    /// @param amountTokenMin  Minimum token to receive.
    /// @param amountAVAXMin   Minimum AVAX to receive.
    /// @param recipient    Address to receive withdrawn tokens and AVAX.
    function removeLiquidityAVAX(
        address token,
        address pairAddress,
        uint256 liquidity,
        uint256 amountTokenMin,
        uint256 amountAVAXMin,
        address recipient
    ) external onlyExecutor returns (uint256 amountToken, uint256 amountAVAX) {
        if (liquidity == 0) revert ZeroLiquidity();

        IERC20(pairAddress).forceApprove(address(router), liquidity);

        (amountToken, amountAVAX) = router.removeLiquidityAVAX(
            token,
            liquidity,
            amountTokenMin,
            amountAVAXMin,
            recipient,
            block.timestamp + 300
        );
    }

    // ══════════════════════════════════════════════════════════════════════════
    //  FARM — STAKE / UNSTAKE / CLAIM REWARDS
    // ══════════════════════════════════════════════════════════════════════════

    /// @notice Deposit LP tokens into a MasterChefJoeV3 farm.
    /// @dev Pending JOE is automatically harvested by MCV3 on each deposit.
    ///      Harvested JOE lands on this proxy — forward it to recipient.
    /// @param pid       Farm pool id.
    /// @param amount    LP token amount to stake.
    /// @param lpToken   LP token address (for approve + JOE sweep).
    /// @param recipient Address to receive auto-harvested JOE rewards.
    function stake(
        uint256 pid,
        uint256 amount,
        address lpToken,
        address recipient
    ) external onlyExecutor {
        if (amount == 0) revert ZeroAmount();
        if (address(masterChef) == address(0)) revert MasterChefNotInitialized();

        IERC20(lpToken).forceApprove(address(masterChef), amount);
        masterChef.deposit(pid, amount);

        // MCV3 auto-harvests JOE on deposit — sweep any JOE to recipient
        _sweepJoe(recipient);
    }

    /// @notice Withdraw LP tokens from a MasterChefJoeV3 farm.
    /// @dev MCV3 sends LP tokens + JOE rewards to msg.sender (this proxy) on withdraw.
    /// @param pid       Farm pool id.
    /// @param amount    LP token amount to unstake.
    /// @param lpToken   LP token address to forward to recipient.
    /// @param recipient Address to receive LP tokens and JOE rewards.
    function unstake(
        uint256 pid,
        uint256 amount,
        address lpToken,
        address recipient
    ) external onlyExecutor {
        if (address(masterChef) == address(0)) revert MasterChefNotInitialized();

        masterChef.withdraw(pid, amount);

        // Forward LP tokens to recipient
        if (amount > 0) {
            uint256 lpBalance = IERC20(lpToken).balanceOf(address(this));
            if (lpBalance > 0) IERC20(lpToken).safeTransfer(recipient, lpBalance);
        }

        // Forward harvested JOE to recipient
        _sweepJoe(recipient);
    }

    /// @notice Harvest JOE rewards without moving LP tokens (deposit 0 pattern).
    /// @param pid       Farm pool id.
    /// @param recipient Address to receive harvested JOE.
    function claimRewards(uint256 pid, address recipient) external onlyExecutor {
        if (address(masterChef) == address(0)) revert MasterChefNotInitialized();

        // MCV3 harvest pattern: deposit(pid, 0) sends pending JOE to msg.sender
        masterChef.deposit(pid, 0);
        _sweepJoe(recipient);
    }

    // ── VIEW ─────────────────────────────────────────────────────────────────

    /// @notice Preview output amounts for a swap path.
    function getAmountsOut(uint256 amountIn, address[] calldata path) external view returns (uint256[] memory) {
        return router.getAmountsOut(amountIn, path);
    }

    // ── INTERNAL ─────────────────────────────────────────────────────────────

    /// @dev Transfers the full JOE balance of this proxy to recipient.
    function _sweepJoe(address recipient) internal {
        if (joeToken == address(0)) return;
        uint256 bal = IERC20(joeToken).balanceOf(address(this));
        if (bal > 0) IERC20(joeToken).safeTransfer(recipient, bal);
    }

    // ── FALLBACK ─────────────────────────────────────────────────────────────

    receive() external payable {}
}
