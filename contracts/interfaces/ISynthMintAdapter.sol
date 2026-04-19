// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title ISynthMintAdapter
 * @notice Strict interface for synthetic-asset / CDP protocols (Metronome, Liquity,
 *         Alchemix, MakerDAO). The four primitives below compose every user flow:
 *         open position, leverage, partial repay/withdraw, close.
 *
 *         Adapter-specific methods — `unwind`, `flashIssue`, `leveragedDeposit`,
 *         cross-pool synth swap — live on the concrete adapter. They are not part of
 *         this family because they are compositions of the four primitives (or
 *         protocol-specific optimizations) and protocols do not implement them
 *         consistently.
 *
 *         Canonical selectors (full Solidity signature → `ethers.id(sig).slice(0, 10)`):
 *           - `depositCollateral(address,uint256)`
 *           - `withdrawCollateral(address,uint256,address)`
 *           - `mintSynth(address,uint256,address)`
 *           - `repaySynth(address,uint256)`
 *
 *         See ADR 0002 for the full design rationale.
 */
interface ISynthMintAdapter {
    /**
     * @notice Deposit collateral into a CDP position.
     * @dev The collateral is pulled from the adapter proxy (executor already
     *      transferred it in via a `Transfer`). Proxy is the accountable address
     *      for the deposited collateral — matches BeaconProxy-per-user isolation.
     * @param depositToken Protocol's per-collateral deposit token (e.g. msdWETH on
     *                     Metronome). NOT the raw underlying — the deposit-token
     *                     wrapper that tracks the position.
     * @param amount       Amount of underlying collateral to deposit.
     * @return deposited   Net amount credited after protocol fees. `deposited <= amount`.
     */
    function depositCollateral(address depositToken, uint256 amount)
        external
        returns (uint256 deposited);

    /**
     * @notice Withdraw collateral from a CDP position.
     * @dev Reverts if the remaining position would drop below the protocol's
     *      minimum collateralization ratio. Protocols enforce this on-chain; we
     *      do not re-validate.
     * @param depositToken Same as `depositCollateral`.
     * @param amount       Amount of underlying collateral to withdraw.
     * @param recipient    Where the underlying collateral lands.
     * @return withdrawn   Net amount sent to `recipient` after fees.
     */
    function withdrawCollateral(address depositToken, uint256 amount, address recipient)
        external
        returns (uint256 withdrawn);

    /**
     * @notice Mint (issue) a synthetic asset against the proxy's collateral.
     * @dev Reverts if the resulting position is under-collateralized per the
     *      protocol's rules. The proxy is the debt holder of record.
     * @param debtToken  Protocol's per-synthetic debt token (e.g. msdUSD-debt on
     *                   Metronome). The actual synthetic ERC20 (msUSD) is derived
     *                   by the protocol and sent to `recipient`.
     * @param amount     Amount of synthetic to mint.
     * @param recipient  Where the minted synthetic lands.
     * @return minted    Net amount sent to `recipient` after fees.
     */
    function mintSynth(address debtToken, uint256 amount, address recipient)
        external
        returns (uint256 minted);

    /**
     * @notice Burn synthetic assets to reduce the proxy's debt.
     * @dev The synthetic must already live in the proxy (executor transferred it
     *      in via a `Transfer`). `repay` here is a misnomer inherited from the
     *      Compound lexicon — the underlying operation is a *burn* against the
     *      user's debt position.
     * @param debtToken Same as `mintSynth`.
     * @param amount    Amount of synthetic to burn.
     * @return repaid   Net debt reduction after protocol fees. Typically equals
     *                  `amount`, but protocols may charge a repay fee.
     */
    function repaySynth(address debtToken, uint256 amount)
        external
        returns (uint256 repaid);
}
