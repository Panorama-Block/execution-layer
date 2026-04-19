// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Initializable} from "@openzeppelin/contracts/proxy/utils/Initializable.sol";
import {
    IMetronomeDepositToken,
    IMetronomeDebtToken,
    IMetronomePool
} from "../interfaces/IMetronome.sol";
import {ISynthMintAdapter} from "../../interfaces/ISynthMintAdapter.sol";

/**
 * @title MetronomeAdapter
 * @notice Proxy-compatible adapter for Metronome Synth on Base.
 * @dev Implements `ISynthMintAdapter` (see ADR 0002).
 *
 *      Architecture note: Metronome is a CDP / synthetic-mint protocol. Operations
 *      run through per-token contracts, not a monolithic Pool:
 *        - `IMetronomeDepositToken` handles collateral (one per collateral asset)
 *        - `IMetronomeDebtToken`    handles synthetic issuance (one per synthetic)
 *        - `IMetronomePool`         orchestrates (we only use it for existence checks)
 *
 *      Each user gets their own BeaconProxy of this adapter — isolates position state.
 *      The proxy is the accountable address for both collateral and debt in Metronome.
 *
 *      Base mainnet addresses (stored at init time via initArgs):
 *        - Pool:         0xc614136d6c5AB85bc2aCF0ec2652351642d7F54E
 *        - PoolRegistry: 0x4372A2b9304296c06197a823f25Cf03119d2Fd82
 *
 *      Storage layout (append-only — never reorder):
 *        slot 0: pool (IMetronomePool)
 *        slot 1: poolRegistry (address)
 *        slot 2: executor (address)
 *        slots 3-52: __gap (50 reserved)
 */
contract MetronomeAdapter is Initializable, ISynthMintAdapter {
    using SafeERC20 for IERC20;

    // ========== STORAGE ==========

    IMetronomePool public pool;
    address public poolRegistry;
    address public executor;

    // ========== STORAGE GAP ==========

    uint256[50] private __gap;

    // ========== ERRORS ==========

    error OnlyExecutor();
    error ZeroAmount();
    error UnregisteredMarket();
    error NoDebtToRepay();

    // ========== MODIFIERS ==========

    modifier onlyExecutor() {
        if (msg.sender != executor) revert OnlyExecutor();
        _;
    }

    // ========== INITIALIZER ==========

    /**
     * @notice Initialize the adapter proxy.
     * @dev initArgs = abi.encode(poolAddress, poolRegistryAddress).
     *
     * @param _executor  The PanoramaExecutorV2 contract address.
     * @param _initArgs  ABI-encoded: (address pool, address poolRegistry).
     */
    function initializeFull(address _executor, bytes calldata _initArgs) external initializer {
        executor = _executor;
        (address _pool, address _poolRegistry) = abi.decode(_initArgs, (address, address));
        pool = IMetronomePool(_pool);
        poolRegistry = _poolRegistry;
    }

    // ========== SYNTH MINT ADAPTER (STRICT) ==========

    /**
     * @notice Deposit underlying collateral into Metronome.
     * @dev The proxy becomes the credited collateral holder in the deposit-token
     *      contract. Executor already pulled `amount` of the underlying token into
     *      this proxy before calling.
     */
    function depositCollateral(address depositToken, uint256 amount)
        external
        override
        onlyExecutor
        returns (uint256 deposited)
    {
        if (amount == 0) revert ZeroAmount();
        if (!pool.doesDepositTokenExist(depositToken)) revert UnregisteredMarket();

        address underlying = IMetronomeDepositToken(depositToken).underlying();
        IERC20(underlying).forceApprove(depositToken, amount);

        (deposited,) = IMetronomeDepositToken(depositToken).deposit(amount, address(this));
    }

    /**
     * @notice Withdraw underlying collateral to `recipient`.
     * @dev Reverts in Metronome if the withdrawal would leave the position under-
     *      collateralized. We do not re-check here — Metronome's on-chain guard is
     *      authoritative.
     */
    function withdrawCollateral(address depositToken, uint256 amount, address recipient)
        external
        override
        onlyExecutor
        returns (uint256 withdrawn)
    {
        if (amount == 0) revert ZeroAmount();
        if (!pool.doesDepositTokenExist(depositToken)) revert UnregisteredMarket();

        address underlying = IMetronomeDepositToken(depositToken).underlying();
        uint256 balBefore = IERC20(underlying).balanceOf(address(this));

        (withdrawn,) = IMetronomeDepositToken(depositToken).withdraw(amount, address(this));

        // Forward to recipient — adapter proxy never keeps user funds.
        uint256 balAfter = IERC20(underlying).balanceOf(address(this));
        uint256 received = balAfter - balBefore;
        if (received > 0) {
            IERC20(underlying).safeTransfer(recipient, received);
        }
    }

    /**
     * @notice Mint synthetic against the proxy's collateral.
     * @dev Synthetic ERC20 is sent directly to `recipient` by the debt-token contract.
     */
    function mintSynth(address debtToken, uint256 amount, address recipient)
        external
        override
        onlyExecutor
        returns (uint256 minted)
    {
        if (amount == 0) revert ZeroAmount();
        if (!pool.doesDebtTokenExist(debtToken)) revert UnregisteredMarket();

        (minted,) = IMetronomeDebtToken(debtToken).issue(amount, recipient);
    }

    /**
     * @notice Burn synthetic to repay the proxy's debt.
     * @dev The synthetic must already live in this proxy (executor transferred it in).
     */
    function repaySynth(address debtToken, uint256 amount)
        external
        override
        onlyExecutor
        returns (uint256 repaid)
    {
        if (amount == 0) revert ZeroAmount();
        if (!pool.doesDebtTokenExist(debtToken)) revert UnregisteredMarket();

        address synth = IMetronomeDebtToken(debtToken).syntheticToken();
        IERC20(synth).forceApprove(debtToken, amount);

        (repaid,) = IMetronomeDebtToken(debtToken).repay(address(this), amount);
    }

    // ========== ADAPTER-SPECIFIC CONVENIENCE ==========

    /**
     * @notice Close a position atomically: repay all debt + withdraw all collateral.
     * @dev Adapter-specific (see ADR 0002 §why-no-unwind). Calls Metronome's native
     *      `repayAll` for gas efficiency, then withdraws the full deposit-token
     *      balance of this proxy.
     *
     *      Executor must have transferred enough synthetic into this proxy to cover
     *      the full debt before calling. If the proxy has excess synth, it's refunded
     *      to `recipient`.
     *
     * @param debtToken    Metronome debt-token for the synthetic to burn.
     * @param depositToken Metronome deposit-token for the collateral to release.
     * @param recipient    Address to receive released collateral + any synth dust.
     */
    function unwind(address debtToken, address depositToken, address recipient)
        external
        onlyExecutor
        returns (uint256 repaid, uint256 withdrawn)
    {
        if (!pool.doesDebtTokenExist(debtToken)) revert UnregisteredMarket();
        if (!pool.doesDepositTokenExist(depositToken)) revert UnregisteredMarket();

        address synth = IMetronomeDebtToken(debtToken).syntheticToken();
        uint256 synthBalBefore = IERC20(synth).balanceOf(address(this));
        if (synthBalBefore == 0) revert NoDebtToRepay();

        IERC20(synth).forceApprove(debtToken, synthBalBefore);
        (repaid,) = IMetronomeDebtToken(debtToken).repayAll(address(this));

        // Refund any synth the user over-funded.
        uint256 synthBalAfter = IERC20(synth).balanceOf(address(this));
        if (synthBalAfter > 0) {
            IERC20(synth).safeTransfer(recipient, synthBalAfter);
        }

        // Withdraw the full deposit-token balance → forward underlying to recipient.
        uint256 depShares = IMetronomeDepositToken(depositToken).balanceOf(address(this));
        if (depShares > 0) {
            address underlying = IMetronomeDepositToken(depositToken).underlying();
            uint256 undBefore = IERC20(underlying).balanceOf(address(this));
            (withdrawn,) = IMetronomeDepositToken(depositToken).withdraw(depShares, address(this));
            uint256 undAfter = IERC20(underlying).balanceOf(address(this));
            uint256 received = undAfter - undBefore;
            if (received > 0) {
                IERC20(underlying).safeTransfer(recipient, received);
            }
        }
    }

    // ========== VIEW ==========

    /// @notice Current collateral balance (in deposit-token shares) of this proxy.
    function collateralBalance(address depositToken) external view returns (uint256) {
        return IMetronomeDepositToken(depositToken).balanceOf(address(this));
    }

    /// @notice Current debt balance (in synthetic units) of this proxy.
    function debtBalance(address debtToken) external view returns (uint256) {
        return IMetronomeDebtToken(debtToken).balanceOf(address(this));
    }

    // ========== FALLBACK ==========

    receive() external payable {}
}
