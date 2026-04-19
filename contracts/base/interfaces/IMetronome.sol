// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title Metronome Synth protocol interfaces (Base)
 * @notice Minimal external surface we actually call. Full ABIs live at
 *         https://github.com/autonomoussoftware/metronome-synth-public.
 *
 *         Deployed Base addresses (mainnet 8453):
 *           - Pool:              0xc614136d6c5AB85bc2aCF0ec2652351642d7F54E
 *           - PoolRegistry:      0x4372A2b9304296c06197a823f25Cf03119d2Fd82
 *           - USDCDepositToken:  0xC7F2f79Daa7Ea4FBbF60b45b5D6028BDE2453476
 *           - WETHDepositToken:  0x8b581d0013F571a792c3Aa8AF2a0366A309BF51E
 *           - msETH:             0x7Ba6F01772924a82D9626c126347A28299E98c98
 *           - msUSD:             0x526728DBc96689597F85ae4cd716d4f7fCcBAE9d
 *
 *         Note — operations go through per-token contracts, NOT the Pool.
 *         Pool is the orchestrator (liquidations, synth-to-synth swaps).
 */

/**
 * @notice DepositToken — one per collateral asset. Wraps the underlying and
 *         tracks the user's collateral position.
 */
interface IMetronomeDepositToken {
    /// @notice Pull underlying from msg.sender, credit a deposit position to `onBehalfOf_`.
    /// @return _deposited Net amount credited after protocol fee.
    /// @return _fee       Protocol fee taken.
    function deposit(uint256 amount_, address onBehalfOf_)
        external
        returns (uint256 _deposited, uint256 _fee);

    /// @notice Burn msg.sender's deposit tokens, send underlying to `to_`.
    /// @return _withdrawn Net amount sent after protocol fee.
    /// @return _fee       Protocol fee taken.
    function withdraw(uint256 amount_, address to_)
        external
        returns (uint256 _withdrawn, uint256 _fee);

    /// @notice Underlying ERC20 wrapped by this deposit token.
    function underlying() external view returns (address);

    /// @notice ERC20 balance of deposit-token shares (not underlying).
    function balanceOf(address account) external view returns (uint256);
}

/**
 * @notice DebtToken — one per synthetic asset. Tracks the user's debt position
 *         and mediates issuance / repayment of the corresponding synthetic.
 */
interface IMetronomeDebtToken {
    /// @notice Mint synthetic to `to_`, create debt on msg.sender.
    /// @return _issued Net synthetic sent to `to_` after protocol fee.
    /// @return _fee    Protocol fee taken.
    function issue(uint256 amount_, address to_)
        external
        returns (uint256 _issued, uint256 _fee);

    /// @notice Burn synthetic from msg.sender, reduce debt on `onBehalfOf_`.
    /// @return _repaid Net debt reduction after protocol fee.
    /// @return _fee    Protocol fee taken.
    function repay(address onBehalfOf_, uint256 amount_)
        external
        returns (uint256 _repaid, uint256 _fee);

    /// @notice Repay the entire debt of `onBehalfOf_`. Amount is sourced from msg.sender.
    /// @return _repaid Net debt cleared after protocol fee.
    /// @return _fee    Protocol fee taken.
    function repayAll(address onBehalfOf_) external returns (uint256 _repaid, uint256 _fee);

    /// @notice The synthetic ERC20 this debt token tracks (e.g. msUSD, msETH).
    function syntheticToken() external view returns (address);

    /// @notice Current debt balance of `account` in synthetic units.
    function balanceOf(address account) external view returns (uint256);
}

/**
 * @notice Pool — orchestrator. We only need it to look up whether a market is
 *         registered and to fetch the debt/collateral caps if we want to
 *         pre-validate on the backend. No execution-side calls go here.
 */
interface IMetronomePool {
    /// @notice Returns whether this deposit-token address is registered in the pool.
    function doesDepositTokenExist(address depositToken_) external view returns (bool);

    /// @notice Returns whether this debt-token address is registered in the pool.
    function doesDebtTokenExist(address debtToken_) external view returns (bool);
}
