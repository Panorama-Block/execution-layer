// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import {PanoramaExecutorV2}    from "../../contracts/aerodrome/core/PanoramaExecutorV2.sol";
import {MoonwellLendAdapter}   from "../../contracts/base/adapters/MoonwellLendAdapter.sol";
import {UpgradeableBeacon}     from "@openzeppelin/contracts/proxy/beacon/UpgradeableBeacon.sol";
import {BeaconProxy}           from "@openzeppelin/contracts/proxy/beacon/BeaconProxy.sol";
import {IERC20}                from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * @title MoonwellLendForkTest
 * @notice Fork tests against Moonwell on Base mainnet.
 * @dev Run with:
 *      BASE_RPC_URL=https://mainnet.base.org forge test \
 *        --match-contract MoonwellLendForkTest \
 *        --fork-url $BASE_RPC_URL \
 *        -vvv
 */
contract MoonwellLendForkTest is Test {
    // ── Base mainnet addresses ────────────────────────────────────────────────

    address constant MOONWELL_COMPTROLLER = 0xfBb21d0380beE3312B33c4353c8936a0F13EF26C;
    address constant WETH                 = 0x4200000000000000000000000000000000000006;
    address constant USDC                 = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913;
    address constant M_USDC               = 0xEdc817A28E8B93B03976FBd4a3dDBc9f7D176c22;
    address constant M_WETH               = 0x628ff693426583D9a7FB391E54366292F509D457;

    // ── Selectors ─────────────────────────────────────────────────────────────

    bytes4 constant SUPPLY_SEL     = bytes4(keccak256("supply(address,uint256,address)"));
    bytes4 constant REDEEM_SEL     = bytes4(keccak256("redeem(address,uint256,address)"));
    bytes4 constant BORROW_SEL     = bytes4(keccak256("borrow(address,uint256,address)"));
    bytes4 constant REPAY_SEL      = bytes4(keccak256("repay(address,uint256)"));
    bytes4 constant SUPPLY_ETH_SEL = bytes4(keccak256("supplyETH(address,address)"));
    bytes4 constant REDEEM_ETH_SEL = bytes4(keccak256("redeemETH(address,uint256,address)"));
    bytes4 constant BORROW_ETH_SEL = bytes4(keccak256("borrowETH(address,uint256,address)"));
    bytes4 constant REPAY_ETH_SEL  = bytes4(keccak256("repayETH(address)"));
    bytes4 constant ENTER_SEL      = bytes4(keccak256("enterMarkets(address[])"));

    bytes32 constant MOONWELL_ID = keccak256("moonwell");

    // ── Contracts ─────────────────────────────────────────────────────────────

    PanoramaExecutorV2  public executor;
    UpgradeableBeacon   public beacon;
    MoonwellLendAdapter public adapterImpl;

    address public user = makeAddr("user");

    // ── Setup ─────────────────────────────────────────────────────────────────

    function setUp() public {
        vm.createSelectFork(vm.envOr("BASE_RPC_URL", string("https://mainnet.base.org")));

        adapterImpl = new MoonwellLendAdapter();
        beacon      = new UpgradeableBeacon(address(adapterImpl), address(this));
        executor    = new PanoramaExecutorV2();

        bytes memory initArgs = abi.encode(MOONWELL_COMPTROLLER, WETH);
        executor.registerBeacon(MOONWELL_ID, address(beacon), initArgs);

        vm.deal(user, 10 ether);
        deal(USDC, user, 10_000e6);
        deal(WETH, user, 10 ether);
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    function _transfer(address token, uint256 amount)
        internal pure returns (PanoramaExecutorV2.Transfer[] memory t)
    {
        t = new PanoramaExecutorV2.Transfer[](1);
        t[0] = PanoramaExecutorV2.Transfer({token: token, amount: amount});
    }

    function _noTransfers() internal pure returns (PanoramaExecutorV2.Transfer[] memory t) {
        t = new PanoramaExecutorV2.Transfer[](0);
    }

    function _deadline() internal view returns (uint256) {
        return block.timestamp + 300;
    }

    // ── Test 1: supply USDC ───────────────────────────────────────────────────

    function test_Fork_SupplyUSDC() public {
        uint256 supplyAmount = 1_000e6;

        vm.startPrank(user);
        IERC20(USDC).approve(address(executor), supplyAmount);

        bytes memory data = abi.encode(M_USDC, supplyAmount, user);
        executor.execute(MOONWELL_ID, SUPPLY_SEL, _transfer(USDC, supplyAmount), _deadline(), data);
        vm.stopPrank();

        assertGt(IERC20(M_USDC).balanceOf(user), 0, "user should hold mUSDC after supply");
    }

    // ── Test 2: supply then redeem USDC ───────────────────────────────────────

    function test_Fork_SupplyAndRedeemUSDC() public {
        uint256 supplyAmount = 1_000e6;
        uint256 usdcBefore   = IERC20(USDC).balanceOf(user);

        vm.startPrank(user);
        IERC20(USDC).approve(address(executor), supplyAmount);

        // Supply
        bytes memory supplyData = abi.encode(M_USDC, supplyAmount, user);
        executor.execute(MOONWELL_ID, SUPPLY_SEL, _transfer(USDC, supplyAmount), _deadline(), supplyData);

        uint256 mTokenBalance = IERC20(M_USDC).balanceOf(user);
        assertGt(mTokenBalance, 0, "should have mUSDC after supply");

        // Redeem all mTokens
        IERC20(M_USDC).approve(address(executor), mTokenBalance);
        bytes memory redeemData = abi.encode(M_USDC, mTokenBalance, user);
        executor.execute(MOONWELL_ID, REDEEM_SEL, _transfer(M_USDC, mTokenBalance), _deadline(), redeemData);
        vm.stopPrank();

        uint256 usdcAfter = IERC20(USDC).balanceOf(user);
        // Allow 1 USDC of rounding loss from exchange rate
        assertApproxEqAbs(usdcAfter, usdcBefore, 1e6, "USDC balance should be ~restored after redeem");
    }

    // ── Test 3: supply USDC then borrow WETH ─────────────────────────────────

    function test_Fork_SupplyUSDC_BorrowWETH() public {
        uint256 supplyAmount = 5_000e6;
        uint256 borrowAmount = 0.001 ether;

        vm.startPrank(user);
        IERC20(USDC).approve(address(executor), supplyAmount);

        // Supply USDC as collateral
        bytes memory supplyData = abi.encode(M_USDC, supplyAmount, user);
        executor.execute(MOONWELL_ID, SUPPLY_SEL, _transfer(USDC, supplyAmount), _deadline(), supplyData);

        // Enter mUSDC market to use as collateral
        uint256 mUSDCBalance = IERC20(M_USDC).balanceOf(user);
        IERC20(M_USDC).approve(address(executor), mUSDCBalance);
        address[] memory markets = new address[](1);
        markets[0] = M_USDC;
        bytes memory enterData = abi.encode(markets);
        executor.execute(MOONWELL_ID, ENTER_SEL, _noTransfers(), _deadline(), enterData);

        // Borrow WETH
        uint256 wethBefore = IERC20(WETH).balanceOf(user);
        bytes memory borrowData = abi.encode(M_WETH, borrowAmount, user);
        executor.execute(MOONWELL_ID, BORROW_SEL, _noTransfers(), _deadline(), borrowData);
        vm.stopPrank();

        assertGt(IERC20(WETH).balanceOf(user) - wethBefore, 0, "user should receive borrowed WETH");
    }

    // ── Test 4: repay WETH borrow ─────────────────────────────────────────────

    function test_Fork_RepayWETH() public {
        uint256 supplyAmount = 5_000e6;
        uint256 borrowAmount = 0.001 ether;

        vm.startPrank(user);

        // Supply USDC as collateral
        IERC20(USDC).approve(address(executor), supplyAmount);
        executor.execute(MOONWELL_ID, SUPPLY_SEL,
            _transfer(USDC, supplyAmount), _deadline(),
            abi.encode(M_USDC, supplyAmount, user));

        // Enter mUSDC market
        uint256 mUSDCBalance = IERC20(M_USDC).balanceOf(user);
        IERC20(M_USDC).approve(address(executor), mUSDCBalance);
        address[] memory markets = new address[](1);
        markets[0] = M_USDC;
        executor.execute(MOONWELL_ID, ENTER_SEL, _noTransfers(), _deadline(), abi.encode(markets));

        // Borrow WETH
        executor.execute(MOONWELL_ID, BORROW_SEL, _noTransfers(), _deadline(),
            abi.encode(M_WETH, borrowAmount, user));

        // Repay WETH
        IERC20(WETH).approve(address(executor), borrowAmount);
        executor.execute(MOONWELL_ID, REPAY_SEL,
            _transfer(WETH, borrowAmount), _deadline(),
            abi.encode(M_WETH, borrowAmount));

        vm.stopPrank();
        // If repay reverts, test fails — success means repay worked
    }

    // ── Test 5: supply native ETH (wraps to WETH internally) ─────────────────

    function test_Fork_SupplyETH() public {
        uint256 ethAmount = 0.1 ether;

        vm.startPrank(user);
        bytes memory data = abi.encode(M_WETH, user);
        executor.execute{value: ethAmount}(MOONWELL_ID, SUPPLY_ETH_SEL, _noTransfers(), _deadline(), data);
        vm.stopPrank();

        assertGt(IERC20(M_WETH).balanceOf(user), 0, "user should hold mWETH after supplyETH");
    }

    // ── Test 6: supply ETH then redeem to ETH ────────────────────────────────

    function test_Fork_SupplyETH_RedeemETH() public {
        uint256 ethAmount  = 0.1 ether;
        uint256 ethBefore  = user.balance;

        vm.startPrank(user);

        // Supply ETH
        executor.execute{value: ethAmount}(MOONWELL_ID, SUPPLY_ETH_SEL, _noTransfers(), _deadline(),
            abi.encode(M_WETH, user));

        uint256 mWethBalance = IERC20(M_WETH).balanceOf(user);
        assertGt(mWethBalance, 0);

        // Redeem mWETH → ETH
        IERC20(M_WETH).approve(address(executor), mWethBalance);
        executor.execute(MOONWELL_ID, REDEEM_ETH_SEL,
            _transfer(M_WETH, mWethBalance), _deadline(),
            abi.encode(M_WETH, mWethBalance, user));

        vm.stopPrank();

        // Should get back approximately the ETH supplied (within 0.001 ETH rounding)
        assertApproxEqAbs(user.balance, ethBefore, 0.001 ether, "should recover ~same ETH");
    }
}
