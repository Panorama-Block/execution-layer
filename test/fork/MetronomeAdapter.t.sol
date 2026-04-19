// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import {IERC20}           from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {MetronomeAdapter} from "../../contracts/base/adapters/MetronomeAdapter.sol";
import {
    IMetronomeDepositToken,
    IMetronomeDebtToken,
    IMetronomePool
}                         from "../../contracts/base/interfaces/IMetronome.sol";

/**
 * @title MetronomeAdapterForkTest
 * @notice End-to-end tests for MetronomeAdapter against real Metronome Synth
 *         contracts on Base mainnet. No mocks.
 *
 * @dev Run with:
 *      BASE_RPC_URL=https://mainnet.base.org forge test \
 *        --match-contract MetronomeAdapterForkTest --evm-version cancun -vvv
 *
 *      `--evm-version cancun` is required because Metronome's live Pool proxy
 *      uses post-Paris opcodes (TSTORE/MCOPY). The repo default is `paris`
 *      (foundry.toml) — overriding here does not affect compilation of our own
 *      adapters, only Foundry's EVM interpreter for forked state.
 *
 *      The adapter is deployed fresh here (no BeaconProxy) — that mirrors the
 *      post-initialize state of the per-user proxy. Executor is simulated via
 *      `vm.prank(executor)` so we exercise the exact `onlyExecutor` path.
 */
contract MetronomeAdapterForkTest is Test {
    // ── Metronome — Base mainnet (8453) ─────────────────────────────────────
    address constant POOL                = 0xc614136d6c5AB85bc2aCF0ec2652351642d7F54E;
    address constant POOL_REGISTRY       = 0x4372A2b9304296c06197a823f25Cf03119d2Fd82;
    address constant USDC_DEPOSIT_TOKEN  = 0xC7F2f79Daa7Ea4FBbF60b45b5D6028BDE2453476;
    address constant MS_USD_DEBT_TOKEN   = 0x7bcC1DEcCaa98D52Bf89485f17a3E8607011cFde;
    address constant MS_USD              = 0x526728DBc96689597F85ae4cd716d4f7fCcBAE9d;
    address constant USDC                = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913;

    MetronomeAdapter internal adapter;
    address internal executor  = makeAddr("executor");
    address internal recipient = makeAddr("recipient");

    uint256 internal constant DEPOSIT_AMOUNT = 1_000e6; // 1,000 USDC (6 decimals)

    // Pin a recent block so state reads hit Foundry's local cache on re-runs.
    // Bump only when Metronome governance ships a material change you want to test.
    uint256 internal constant FORK_BLOCK = 44_828_900;

    function setUp() public {
        string memory rpcUrl = vm.envOr("BASE_RPC_URL", string("https://mainnet.base.org"));
        vm.createSelectFork(rpcUrl, FORK_BLOCK);

        adapter = new MetronomeAdapter();
        adapter.initializeFull(executor, abi.encode(POOL, POOL_REGISTRY));
    }

    // ─── initializeFull ──────────────────────────────────────────────────────

    function test_Fork_Initialize_StoresPoolAndExecutor() public view {
        assertEq(address(adapter.pool()),   POOL);
        assertEq(adapter.poolRegistry(),    POOL_REGISTRY);
        assertEq(adapter.executor(),        executor);
    }

    function test_Fork_Pool_ReportsLiveMarkets() public view {
        IMetronomePool pool = IMetronomePool(POOL);
        assertTrue(pool.doesDepositTokenExist(USDC_DEPOSIT_TOKEN), "USDC deposit token registered");
        assertTrue(pool.doesDebtTokenExist(MS_USD_DEBT_TOKEN),     "msUSD debt token registered");
    }

    // ─── depositCollateral ───────────────────────────────────────────────────

    function test_Fork_DepositCollateral_CreditsSharesToProxy() public {
        // Pre-fund the proxy as PanoramaExecutorV2 would (via its `transfers` loop).
        deal(USDC, address(adapter), DEPOSIT_AMOUNT);

        uint256 sharesBefore = IERC20(USDC_DEPOSIT_TOKEN).balanceOf(address(adapter));

        vm.prank(executor);
        uint256 deposited = adapter.depositCollateral(USDC_DEPOSIT_TOKEN, DEPOSIT_AMOUNT);

        uint256 sharesAfter = IERC20(USDC_DEPOSIT_TOKEN).balanceOf(address(adapter));

        assertGt(deposited, 0, "deposited > 0 after fee");
        assertEq(sharesAfter - sharesBefore, deposited, "shares credited match return value");
        assertEq(IERC20(USDC).balanceOf(address(adapter)), 0, "proxy shipped all USDC");

        console.log("USDC deposited:", DEPOSIT_AMOUNT);
        console.log("msdUSDC shares credited:", deposited);
    }

    function test_Fork_DepositCollateral_RevertIf_NotExecutor() public {
        deal(USDC, address(adapter), DEPOSIT_AMOUNT);

        address stranger = makeAddr("stranger");
        vm.prank(stranger);
        vm.expectRevert(MetronomeAdapter.OnlyExecutor.selector);
        adapter.depositCollateral(USDC_DEPOSIT_TOKEN, DEPOSIT_AMOUNT);
    }

    function test_Fork_DepositCollateral_RevertIf_ZeroAmount() public {
        vm.prank(executor);
        vm.expectRevert(MetronomeAdapter.ZeroAmount.selector);
        adapter.depositCollateral(USDC_DEPOSIT_TOKEN, 0);
    }

    function test_Fork_DepositCollateral_RevertIf_UnregisteredMarket() public {
        address bogus = makeAddr("bogusDepositToken");
        deal(USDC, address(adapter), DEPOSIT_AMOUNT);

        vm.prank(executor);
        vm.expectRevert(MetronomeAdapter.UnregisteredMarket.selector);
        adapter.depositCollateral(bogus, DEPOSIT_AMOUNT);
    }

    // ─── withdrawCollateral ──────────────────────────────────────────────────

    function test_Fork_WithdrawCollateral_ForwardsToRecipient() public {
        deal(USDC, address(adapter), DEPOSIT_AMOUNT);
        vm.prank(executor);
        uint256 deposited = adapter.depositCollateral(USDC_DEPOSIT_TOKEN, DEPOSIT_AMOUNT);

        uint256 recipientBefore = IERC20(USDC).balanceOf(recipient);

        vm.prank(executor);
        uint256 withdrawn = adapter.withdrawCollateral(USDC_DEPOSIT_TOKEN, deposited, recipient);

        uint256 received = IERC20(USDC).balanceOf(recipient) - recipientBefore;

        assertGt(withdrawn, 0, "withdrew non-zero underlying");
        assertEq(received, withdrawn, "recipient received exactly withdrawn amount");
        assertEq(IERC20(USDC_DEPOSIT_TOKEN).balanceOf(address(adapter)), 0, "all shares burned");
        assertEq(IERC20(USDC).balanceOf(address(adapter)), 0, "proxy forwarded all underlying");

        console.log("msdUSDC shares burned:", deposited);
        console.log("USDC withdrawn to recipient:", received);
    }

    function test_Fork_WithdrawCollateral_RevertIf_NotExecutor() public {
        address stranger = makeAddr("stranger");
        vm.prank(stranger);
        vm.expectRevert(MetronomeAdapter.OnlyExecutor.selector);
        adapter.withdrawCollateral(USDC_DEPOSIT_TOKEN, 1, recipient);
    }

    function test_Fork_WithdrawCollateral_RevertIf_ZeroAmount() public {
        vm.prank(executor);
        vm.expectRevert(MetronomeAdapter.ZeroAmount.selector);
        adapter.withdrawCollateral(USDC_DEPOSIT_TOKEN, 0, recipient);
    }

    function test_Fork_WithdrawCollateral_RevertIf_UnregisteredMarket() public {
        address bogus = makeAddr("bogusDepositToken");
        vm.prank(executor);
        vm.expectRevert(MetronomeAdapter.UnregisteredMarket.selector);
        adapter.withdrawCollateral(bogus, 1, recipient);
    }

    // ─── mintSynth ───────────────────────────────────────────────────────────

    function test_Fork_MintSynth_SendsSynthToRecipient() public {
        deal(USDC, address(adapter), DEPOSIT_AMOUNT);
        vm.prank(executor);
        adapter.depositCollateral(USDC_DEPOSIT_TOKEN, DEPOSIT_AMOUNT);

        // Mint conservatively relative to $1k USDC collateral — Metronome has a
        // collateral factor well under 100%, so 100 msUSD keeps us safely above
        // the minimum health factor on mainnet parameters.
        uint256 mintAmount = 100e18;

        uint256 synthBefore = IERC20(MS_USD).balanceOf(recipient);

        vm.prank(executor);
        uint256 minted = adapter.mintSynth(MS_USD_DEBT_TOKEN, mintAmount, recipient);

        uint256 received = IERC20(MS_USD).balanceOf(recipient) - synthBefore;

        assertGt(minted, 0, "minted > 0");
        assertEq(received, minted, "recipient received exactly minted synth");
        assertGt(IERC20(MS_USD_DEBT_TOKEN).balanceOf(address(adapter)), 0, "debt accrues on proxy");

        console.log("msUSD minted to recipient:", received);
        console.log("Debt carried by proxy:", IERC20(MS_USD_DEBT_TOKEN).balanceOf(address(adapter)));
    }

    function test_Fork_MintSynth_RevertIf_NotExecutor() public {
        address stranger = makeAddr("stranger");
        vm.prank(stranger);
        vm.expectRevert(MetronomeAdapter.OnlyExecutor.selector);
        adapter.mintSynth(MS_USD_DEBT_TOKEN, 100e18, recipient);
    }

    function test_Fork_MintSynth_RevertIf_ZeroAmount() public {
        vm.prank(executor);
        vm.expectRevert(MetronomeAdapter.ZeroAmount.selector);
        adapter.mintSynth(MS_USD_DEBT_TOKEN, 0, recipient);
    }

    function test_Fork_MintSynth_RevertIf_UnregisteredMarket() public {
        address bogus = makeAddr("bogusDebtToken");
        vm.prank(executor);
        vm.expectRevert(MetronomeAdapter.UnregisteredMarket.selector);
        adapter.mintSynth(bogus, 100e18, recipient);
    }

    // ─── repaySynth ──────────────────────────────────────────────────────────

    function test_Fork_RepaySynth_ClearsDebt() public {
        deal(USDC, address(adapter), DEPOSIT_AMOUNT);
        vm.prank(executor);
        adapter.depositCollateral(USDC_DEPOSIT_TOKEN, DEPOSIT_AMOUNT);

        // Mint msUSD directly into the proxy so the adapter can burn it on repay.
        uint256 mintAmount = 100e18;
        vm.prank(executor);
        adapter.mintSynth(MS_USD_DEBT_TOKEN, mintAmount, address(adapter));

        uint256 debtBefore = IERC20(MS_USD_DEBT_TOKEN).balanceOf(address(adapter));
        assertGt(debtBefore, 0, "debt was opened");

        // Repay the full synth balance — the protocol trims to outstanding debt.
        uint256 synthBal = IERC20(MS_USD).balanceOf(address(adapter));

        vm.prank(executor);
        uint256 repaid = adapter.repaySynth(MS_USD_DEBT_TOKEN, synthBal);

        uint256 debtAfter = IERC20(MS_USD_DEBT_TOKEN).balanceOf(address(adapter));

        assertGt(repaid, 0, "repaid > 0");
        assertLt(debtAfter, debtBefore, "debt reduced");

        console.log("Debt before:", debtBefore);
        console.log("Debt after:",  debtAfter);
        console.log("Repaid:",      repaid);
    }

    function test_Fork_RepaySynth_RevertIf_NotExecutor() public {
        address stranger = makeAddr("stranger");
        vm.prank(stranger);
        vm.expectRevert(MetronomeAdapter.OnlyExecutor.selector);
        adapter.repaySynth(MS_USD_DEBT_TOKEN, 1e18);
    }

    function test_Fork_RepaySynth_RevertIf_ZeroAmount() public {
        vm.prank(executor);
        vm.expectRevert(MetronomeAdapter.ZeroAmount.selector);
        adapter.repaySynth(MS_USD_DEBT_TOKEN, 0);
    }

    function test_Fork_RepaySynth_RevertIf_UnregisteredMarket() public {
        address bogus = makeAddr("bogusDebtToken");
        vm.prank(executor);
        vm.expectRevert(MetronomeAdapter.UnregisteredMarket.selector);
        adapter.repaySynth(bogus, 1e18);
    }

    // ─── unwind ──────────────────────────────────────────────────────────────

    function test_Fork_Unwind_RepaysFullDebtAndReleasesCollateral() public {
        deal(USDC, address(adapter), DEPOSIT_AMOUNT);
        vm.prank(executor);
        adapter.depositCollateral(USDC_DEPOSIT_TOKEN, DEPOSIT_AMOUNT);

        uint256 mintAmount = 100e18;
        vm.prank(executor);
        adapter.mintSynth(MS_USD_DEBT_TOKEN, mintAmount, address(adapter));

        // Top up the proxy so it covers debt + fees when repayAll is called.
        uint256 debtNow = IERC20(MS_USD_DEBT_TOKEN).balanceOf(address(adapter));
        uint256 synthNow = IERC20(MS_USD).balanceOf(address(adapter));
        if (synthNow < debtNow) {
            deal(MS_USD, address(adapter), debtNow * 11 / 10);
        }

        uint256 recipientUsdcBefore = IERC20(USDC).balanceOf(recipient);

        vm.prank(executor);
        (uint256 repaid, uint256 withdrawn) = adapter.unwind(
            MS_USD_DEBT_TOKEN, USDC_DEPOSIT_TOKEN, recipient
        );

        assertGt(repaid,    0, "repaid non-zero debt");
        assertGt(withdrawn, 0, "withdrew non-zero collateral");
        assertEq(IERC20(MS_USD_DEBT_TOKEN).balanceOf(address(adapter)), 0, "no residual debt");
        assertEq(IERC20(USDC_DEPOSIT_TOKEN).balanceOf(address(adapter)), 0, "no residual shares");
        assertGt(IERC20(USDC).balanceOf(recipient) - recipientUsdcBefore, 0, "underlying forwarded to recipient");

        console.log("Repaid:",            repaid);
        console.log("Collateral out:",    withdrawn);
    }

    function test_Fork_Unwind_RevertIf_NoDebtToRepay() public {
        deal(USDC, address(adapter), DEPOSIT_AMOUNT);
        vm.prank(executor);
        adapter.depositCollateral(USDC_DEPOSIT_TOKEN, DEPOSIT_AMOUNT);

        vm.prank(executor);
        vm.expectRevert(MetronomeAdapter.NoDebtToRepay.selector);
        adapter.unwind(MS_USD_DEBT_TOKEN, USDC_DEPOSIT_TOKEN, recipient);
    }

    // ─── view helpers ────────────────────────────────────────────────────────

    function test_Fork_CollateralBalance_TracksDepositShares() public {
        assertEq(adapter.collateralBalance(USDC_DEPOSIT_TOKEN), 0);

        deal(USDC, address(adapter), DEPOSIT_AMOUNT);
        vm.prank(executor);
        adapter.depositCollateral(USDC_DEPOSIT_TOKEN, DEPOSIT_AMOUNT);

        assertGt(adapter.collateralBalance(USDC_DEPOSIT_TOKEN), 0);
    }

    function test_Fork_DebtBalance_TracksOpenDebt() public {
        deal(USDC, address(adapter), DEPOSIT_AMOUNT);
        vm.prank(executor);
        adapter.depositCollateral(USDC_DEPOSIT_TOKEN, DEPOSIT_AMOUNT);

        vm.prank(executor);
        adapter.mintSynth(MS_USD_DEBT_TOKEN, 100e18, recipient);

        assertGt(adapter.debtBalance(MS_USD_DEBT_TOKEN), 0);
    }
}
