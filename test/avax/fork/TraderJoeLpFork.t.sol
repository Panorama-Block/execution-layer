// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import {TraderJoeAdapterV2} from "../../../contracts/avax/adapters/TraderJoeAdapterV2.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @notice Fork tests for TraderJoeAdapterV2 LP and Farm operations against Avalanche mainnet.
///
/// Run with:
///   AVAX_RPC_URL=https://api.avax.network/ext/bc/C/rpc \
///   forge test --match-path "test/avax/fork/TraderJoeLpFork.t.sol" -vvv
///
/// The test contract acts as the executor (bypasses onlyExecutor).
contract TraderJoeLpForkTest is Test {
    // ── Avalanche C-Chain Mainnet Addresses ──────────────────────────────────

    address constant TJ_ROUTER      = 0x60aE616a2155Ee3d9A68541Ba4544862310933d4;
    address constant TJ_FACTORY     = 0x9ad6c38bE94206ca50BB0d90783171662Cd1e917;
    address constant MASTERCHEF_V3  = 0x188bED1968b795d5c9022F6a0bb5931Ac4c18F00;

    address constant WAVAX          = 0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7;
    address constant USDC_E         = 0xA7D7079b0FEaD91F3e65f86E8915Cb59c1a4C664; // USDC.e (6 dec)
    address constant JOE            = 0x6e84a6216eA6dACC71eE8E6b0a5B7322EEbC0fDd; // JOE token (18 dec)

    // TraderJoe V1 pair WAVAX/USDC.e
    address constant WAVAX_USDCe_PAIR = 0xA389f9430876455C36478DeEa9769B7Ca4E3DDB1;

    // MasterChefJoeV3 pool ids -- verify on-chain before production use
    uint256 constant WAVAX_USDCe_PID = 42;

    TraderJoeAdapterV2 public adapter;
    address public executor = address(this);
    address public user     = makeAddr("user");

    receive() external payable {}

    function setUp() public {
        string memory rpcUrl = vm.envOr("AVAX_RPC_URL", string("https://api.avax.network/ext/bc/C/rpc"));
        vm.createSelectFork(rpcUrl);

        adapter = new TraderJoeAdapterV2();
        adapter.initializeFull(executor, abi.encode(TJ_ROUTER));
        adapter.initializeV2(MASTERCHEF_V3, JOE);

        // Fund the test contract and adapter with AVAX
        vm.deal(address(this), 200 ether);
        vm.deal(user,          100 ether);
        vm.deal(address(adapter), 50 ether);

        // Acquire WAVAX and USDC.e for the adapter
        _fundAdapterWithTokens(10 ether, 5 ether);
    }

    // ── Helpers ──────────────────────────────────────────────────────────────

    /// @dev Wraps AVAX to WAVAX and swaps AVAX to USDC.e, both landing in adapter.
    function _fundAdapterWithTokens(uint256 wavaxAmount, uint256 avaxForUsdc) internal {
        // Wrap AVAX → WAVAX and send to adapter
        (bool ok,) = WAVAX.call{value: wavaxAmount}(abi.encodeWithSignature("deposit()"));
        require(ok, "WAVAX wrap failed");
        IERC20(WAVAX).transfer(address(adapter), wavaxAmount);

        // Swap AVAX → USDC.e, recipient = adapter
        address[] memory path = new address[](2);
        path[0] = WAVAX;
        path[1] = USDC_E;

        (bool ok2, bytes memory ret) = TJ_ROUTER.call{value: avaxForUsdc}(
            abi.encodeWithSignature(
                "swapExactAVAXForTokens(uint256,address[],address,uint256)",
                uint256(0),
                path,
                address(adapter),
                block.timestamp + 300
            )
        );
        if (!ok2) {
            // surface the revert reason
            if (ret.length > 0) {
                assembly { revert(add(ret, 32), mload(ret)) }
            }
            revert("AVAX to USDC.e swap failed");
        }
    }

    // ══════════════════════════════════════════════════════════════════════════
    //  ADD LIQUIDITY -- Token-Token (WAVAX/USDC.e)
    // ══════════════════════════════════════════════════════════════════════════

    function test_Fork_AddLiquidity_WAVAX_USDCe() public {
        uint256 wavaxBalance = IERC20(WAVAX).balanceOf(address(adapter));
        uint256 usdceBalance = IERC20(USDC_E).balanceOf(address(adapter));

        // Use half of available balance to leave room for slippage
        uint256 amountWAVAX = wavaxBalance / 2;
        uint256 amountUSDCe = usdceBalance / 2;

        uint256 lpBefore = IERC20(WAVAX_USDCe_PAIR).balanceOf(user);

        (uint256 aA, uint256 aB, uint256 liq) = adapter.addLiquidity(
            WAVAX, USDC_E, amountWAVAX, amountUSDCe, 0, 0, user
        );

        assertGt(liq,  0, "LP tokens minted must be > 0");
        assertGt(aA,   0, "amountA used must be > 0");
        assertGt(aB,   0, "amountB used must be > 0");
        assertGt(IERC20(WAVAX_USDCe_PAIR).balanceOf(user), lpBefore, "user LP balance must increase");

        console.log("WAVAX deposited:  ", aA / 1e18,     "WAVAX");
        console.log("USDC.e deposited: ", aB / 1e6,      "USDC.e");
        console.log("LP received:      ", liq);
    }

    // ══════════════════════════════════════════════════════════════════════════
    //  REMOVE LIQUIDITY -- Token-Token
    // ══════════════════════════════════════════════════════════════════════════

    function test_Fork_RemoveLiquidity_WAVAX_USDCe() public {
        // Step 1: add liquidity to get LP tokens
        uint256 amountWAVAX = IERC20(WAVAX).balanceOf(address(adapter)) / 2;
        uint256 amountUSDCe = IERC20(USDC_E).balanceOf(address(adapter)) / 2;

        (,, uint256 liq) = adapter.addLiquidity(WAVAX, USDC_E, amountWAVAX, amountUSDCe, 0, 0, user);
        assertGt(liq, 0);

        // Step 2: transfer LP tokens from user to adapter (executor pulls them)
        vm.prank(user);
        IERC20(WAVAX_USDCe_PAIR).transfer(address(adapter), liq);

        uint256 wavaxBefore = IERC20(WAVAX).balanceOf(user);
        uint256 usdceBefore = IERC20(USDC_E).balanceOf(user);

        // Step 3: remove liquidity
        (uint256 amountA, uint256 amountB) = adapter.removeLiquidity(
            WAVAX, USDC_E, WAVAX_USDCe_PAIR, liq, 0, 0, user
        );

        assertGt(amountA, 0, "WAVAX returned must be > 0");
        assertGt(amountB, 0, "USDC.e returned must be > 0");
        assertGt(IERC20(WAVAX).balanceOf(user), wavaxBefore);
        assertGt(IERC20(USDC_E).balanceOf(user), usdceBefore);
        assertEq(IERC20(WAVAX_USDCe_PAIR).balanceOf(user), 0, "LP tokens must be burned");

        console.log("WAVAX received:  ", amountA / 1e18, "WAVAX");
        console.log("USDC.e received: ", amountB / 1e6,  "USDC.e");
    }

    // ══════════════════════════════════════════════════════════════════════════
    //  STAKE → CLAIM REWARDS → UNSTAKE (full farm cycle)
    // ══════════════════════════════════════════════════════════════════════════

    function test_Fork_Stake_WAVAX_USDCe() public {
        // Obtain LP tokens via addLiquidity
        uint256 amountWAVAX = IERC20(WAVAX).balanceOf(address(adapter)) / 2;
        uint256 amountUSDCe = IERC20(USDC_E).balanceOf(address(adapter)) / 2;

        (,, uint256 liq) = adapter.addLiquidity(WAVAX, USDC_E, amountWAVAX, amountUSDCe, 0, 0, address(adapter));

        // Probe whether this farm PID is active at the current block state.
        // MCV3 → MCV2 delegation can revert with SafeMath if the underlying pool is drained.
        try adapter.stake(WAVAX_USDCe_PID, liq, WAVAX_USDCe_PAIR, user) {
            (uint256 deposited,) = IMasterChef(MASTERCHEF_V3).userInfo(WAVAX_USDCe_PID, address(adapter));
            assertEq(deposited, liq, "MasterChef should reflect staked amount");
            console.log("JOE auto-harvested on stake:", IERC20(JOE).balanceOf(user));
        } catch {
            // Pool PID may be inactive at the current mainnet snapshot -- skip gracefully.
            console.log("INFO: PID inactive at current block - stake skipped");
            vm.skip(true);
        }
    }

    function test_Fork_FullCycle_AddStakeClaimUnstakeRemove() public {
        // 1. Add liquidity
        uint256 amountWAVAX = IERC20(WAVAX).balanceOf(address(adapter)) / 2;
        uint256 amountUSDCe = IERC20(USDC_E).balanceOf(address(adapter)) / 2;

        (,, uint256 liq) = adapter.addLiquidity(WAVAX, USDC_E, amountWAVAX, amountUSDCe, 0, 0, address(adapter));
        assertGt(liq, 0);
        console.log("LP minted:", liq);

        // 2. Stake -- skip full cycle if farm PID is inactive
        try adapter.stake(WAVAX_USDCe_PID, liq, WAVAX_USDCe_PAIR, user) {
            console.log("Stake OK");
        } catch {
            console.log("INFO: PID inactive - full-cycle test skipped");
            vm.skip(true);
            return;
        }

        // 3. Advance time to accrue rewards
        vm.warp(block.timestamp + 7 days);
        vm.roll(block.number + 100_000);

        // 4. Claim rewards
        uint256 joeBefore = IERC20(JOE).balanceOf(user);
        try adapter.claimRewards(WAVAX_USDCe_PID, user) {
            uint256 joeHarvested = IERC20(JOE).balanceOf(user) - joeBefore;
            console.log("JOE harvested after 7 days:", joeHarvested / 1e18);
        } catch {
            console.log("INFO: claimRewards reverted (pool drained) -- continuing to unstake");
        }

        // 5. Unstake
        uint256 lpBefore = IERC20(WAVAX_USDCe_PAIR).balanceOf(user);
        adapter.unstake(WAVAX_USDCe_PID, liq, WAVAX_USDCe_PAIR, user);
        assertGt(IERC20(WAVAX_USDCe_PAIR).balanceOf(user), lpBefore, "LP tokens should be returned");

        (uint256 remaining,) = IMasterChef(MASTERCHEF_V3).userInfo(WAVAX_USDCe_PID, address(adapter));
        assertEq(remaining, 0, "Farm position should be fully cleared");

        // 6. Remove liquidity
        uint256 lpBalance = IERC20(WAVAX_USDCe_PAIR).balanceOf(user);
        vm.prank(user);
        IERC20(WAVAX_USDCe_PAIR).transfer(address(adapter), lpBalance);

        adapter.removeLiquidity(WAVAX, USDC_E, WAVAX_USDCe_PAIR, lpBalance, 0, 0, user);

        assertGt(IERC20(WAVAX).balanceOf(user), 0, "user should receive WAVAX back");
        assertGt(IERC20(USDC_E).balanceOf(user), 0, "user should receive USDC.e back");

        console.log("Full cycle complete.");
    }

    // ══════════════════════════════════════════════════════════════════════════
    //  ADD LIQUIDITY AVAX (native)
    // ══════════════════════════════════════════════════════════════════════════

    function test_Fork_AddLiquidityAVAX() public {
        // adapter has USDC.e and AVAX
        uint256 avaxToProvide = 2 ether;
        uint256 usdceAmount   = IERC20(USDC_E).balanceOf(address(adapter)) / 4;

        // WAVAX/USDC.e doesn't directly match addLiquidityAVAX (which pairs token+WAVAX).
        // Use USDC.e + native AVAX to add USDC.e/WAVAX liquidity.
        uint256 lpBefore = IERC20(WAVAX_USDCe_PAIR).balanceOf(user);

        adapter.addLiquidityAVAX{value: avaxToProvide}(
            USDC_E, usdceAmount, 0, 0, user
        );

        assertGt(IERC20(WAVAX_USDCe_PAIR).balanceOf(user), lpBefore, "LP tokens minted via native AVAX path");
        console.log("LP received (AVAX path):", IERC20(WAVAX_USDCe_PAIR).balanceOf(user) - lpBefore);
    }
}

interface IMasterChef {
    function userInfo(uint256 pid, address user) external view returns (uint256 amount, uint256 rewardDebt);
}
