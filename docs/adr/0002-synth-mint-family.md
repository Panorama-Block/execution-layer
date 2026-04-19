# ADR 0002 — ISynthMintAdapter Action Family

- **Status:** Accepted
- **Date:** 2026-04-17
- **Owner:** Execution Layer
- **Related issue:** #480
- **Supersedes:** — (extends ADR 0001)

## Context

Issue #480 introduces Metronome Synth as a new Base protocol. The issue's original wording
suggested the adapter should implement `ILendAdapter + IStakeAdapter`, but investigation of
the real Metronome Synth ABI shows it belongs to a distinct protocol class that none of the
existing four action families (`ISwap`, `ILP`, `ILend`, `IStake`) capture honestly.

Specifically, Metronome is a **CDP / synthetic-asset protocol** (same class as MakerDAO DAI,
Liquity LUSD, Alchemix alAssets). These protocols are architecturally different from Compound-
style money markets:

| Dimension                        | Compound money market (`ILendAdapter`)         | Synthetic mint CDP (this ADR)                   |
| -------------------------------- | ---------------------------------------------- | ----------------------------------------------- |
| Where the borrowed token comes from | Other suppliers' deposits (pool)             | **Minted from nothing** against collateral      |
| Receipt token on deposit         | Yes — cToken/qToken, accrues interest          | Varies (Metronome: msdTokens; Liquity: none)    |
| Collateral yield                 | Yes — supply APY                               | Usually no (except Metronome's productive collateral) |
| Debt semantics                   | Borrow real token from pool                    | Mint synthetic; repay burns it                  |
| Multi-position                   | One position per market                        | Sometimes multi-collateral/multi-synth per pool |
| Exit                             | Redeem cToken for underlying                   | Repay debt → unlock collateral → withdraw       |

Forcing Metronome into `ILendAdapter` would require:
- `supply()` pretending to return a "receiptMinted" that has different semantics.
- `enterMarkets()` / `exitMarket()` as dead no-op functions (Metronome has no entry markets).
- `borrow()` misnamed — it's actually a synthetic *mint*.
- `repay()` misnamed — it's actually a *burn*.

These are not aesthetic nits. They are *bugs-in-waiting* because the next engineer reads
`supply` and applies a mental model that doesn't match the protocol.

## Decision

Create a new **strict** action family: `ISynthMintAdapter`.

```solidity
interface ISynthMintAdapter {
    function depositCollateral(
        address depositToken,
        uint256 amount
    ) external returns (uint256 deposited);

    function withdrawCollateral(
        address depositToken,
        uint256 amount,
        address recipient
    ) external returns (uint256 withdrawn);

    function mintSynth(
        address debtToken,
        uint256 amount,
        address recipient
    ) external returns (uint256 minted);

    function repaySynth(
        address debtToken,
        uint256 amount
    ) external returns (uint256 repaid);
}
```

Four methods. Strict — any implementer **must** provide all four. Convenience operations like
`unwind` (repay-all + withdraw-all in one tx), looped-yield farms, or cross-collateral swaps
stay as adapter-specific methods and do not belong in the base interface.

### Design rationale

#### Why strict, not marker?

ADR 0001 rubric: we make a family strict when the upstream protocol surface is standardized
de facto across the ecosystem. For CDP protocols, the four operations above are **universal**:

| Protocol  | Deposit           | Withdraw           | Mint              | Repay           |
| --------- | ----------------- | ------------------ | ----------------- | --------------- |
| Metronome | `deposit`         | `withdraw`         | `issue`           | `repay`         |
| Liquity   | `openTrove`/`addColl` | `withdrawColl` | `withdrawLUSD`    | `repayLUSD`     |
| MakerDAO  | `join` (Vat)      | `exit`             | `draw`            | `wipe`          |
| Alchemix  | `deposit`         | `withdraw`         | `mint`            | `burn`/`repay`  |

Different names, same semantic operations. The interface normalizes them.

#### Why these four and not more?

Minimal, orthogonal operations. You can compose any user-facing flow from these four:

- **Open position** = `depositCollateral` + `mintSynth`
- **Partial repay** = `repaySynth`
- **Partial withdraw** = `withdrawCollateral` (safe as long as health factor remains)
- **Close position** = `repaySynth(all)` + `withdrawCollateral(all)` (adapter-specific `unwind` = both in one tx)
- **Leverage up** = mint more synth, swap to collateral elsewhere, deposit again
- **Leverage down** = sell collateral, repay

Adding `unwind` or `leveragedDeposit` to the strict interface locks in Metronome-specific
composition that Liquity/Maker don't match.

#### Why return `uint256` on every method?

Protocols take fees on some operations (Metronome charges deposit/withdraw/issue fees). The
return value is the **net actioned amount** after fees. For protocols with no fees, this
equals the input amount. Uniform return type makes the backend module code symmetric.

Adapters that want to surface the fee separately can add a view function
`previewFee(address market, Op op, uint256 amount)` — outside the interface.

#### Why no `unwind` in the interface?

`unwind` is a composition (`repayAll` + `withdrawAll`), not a primitive. Protocols that
support it atomically (Metronome's `repayAll`, Liquity's `closeTrove`) can expose it as an
adapter-specific method. Protocols that don't will synthesize it client-side (two txs in a
bundle). Neither path belongs in the strict interface.

#### Native asset handling

Some synth protocols accept native ETH/AVAX collateral (Liquity). Metronome does not — ETH
must be wrapped to WETH first. Because the pattern varies, native support is **adapter-
specific**, same approach as `ILendAdapter` (`supplyAVAX` lives on `BenqiLendAdapter`, not in
the interface).

### What this ADR does NOT do

- **Does not deprecate `ILendAdapter`.** Compound-style lending is still its own distinct
  family. Benqi and Moonwell stay under `ILendAdapter`.
- **Does not merge synthetic mint into `ILendAdapter` with an enum flag.** Tried mentally,
  rejected — it's the exact "bugs-in-waiting" case that ADR 0001 §2 warns against.
- **Does not constrain the adapter's non-primitive methods.** Metronome's `unwind`, leveraged
  flash-issue, cross-pool synth swap — all stay as typed methods on the concrete adapter.

## Consequences

### Positive

- Metronome (#480) implements `ISynthMintAdapter` honestly — no pretend semantics.
- Liquity, Alchemix, Maker integrations in the future drop into the same interface.
- Backend's `ADAPTER_SELECTORS` gets a new family section; existing selectors untouched.
- Taxonomy remains clear: Lend (money market) ≠ SynthMint (CDP) ≠ Stake (liquid staking)
  ≠ Swap ≠ LP.

### Negative / tradeoffs

- One more interface in the `contracts/interfaces/` folder.
- Reviewers need to know **which family** a new protocol belongs to. Rubric in section 2 of
  this ADR plus the `action-families.md` dev guide should cover it.
- Backend modules for Metronome and (future) Benqi borrow share no code — because the shapes
  genuinely differ. This is the price of honest interfaces.

### Neutral

- No executor change.
- No BundleBuilder change beyond adding selectors.
- No storage layout impact.

## Implementation checklist

- [x] Document the family in this ADR.
- [ ] Create `contracts/interfaces/ISynthMintAdapter.sol` (strict, 4 methods).
- [ ] Create `contracts/base/interfaces/IMetronome.sol` for the Metronome ABI.
- [ ] Create `contracts/base/adapters/MetronomeAdapter.sol` implementing `ISynthMintAdapter`.
  Add adapter-specific `unwind()` that composes `repayAll` + `withdraw(max)`.
- [ ] Deploy script `script/Deploy_MetronomeBeacon.s.sol`.
- [ ] Register protocol in `backend/src/config/protocols.ts`: id `metronome`, chain `base`.
- [ ] Add `ADAPTER_SELECTORS.METRONOME_DEPOSIT_COLLATERAL`, `_MINT_SYNTH`, `_REPAY_SYNTH`,
  `_WITHDRAW_COLLATERAL`, `_UNWIND` using full Solidity signatures.
- [ ] Backend module `backend/src/modules/metronome/` with at minimum `prepare-deposit.usecase.ts`.
- [ ] Unit tests (Foundry) covering the four primitives.
- [ ] Fork test on Base covering deposit → mint → repay → withdraw round-trip.
- [ ] Update `docs/03-smart-contracts/action-families.md` table to include the new family.
- [ ] Update `docs/00-overview/products-deep-dive.md` with a §4.5 or §8 row.

## References

- [ADR 0001 — Action Family Interfaces](0001-action-families.md) — parent rubric.
- Metronome Synth Protocol: [docs.metronome.io](https://docs.metronome.io/metronome-synth/metronome-synth-protocol)
- Metronome Base Pool: `0xc614136d6c5AB85bc2aCF0ec2652351642d7F54E`
- Metronome Synth public contracts: [autonomoussoftware/metronome-synth-public](https://github.com/autonomoussoftware/metronome-synth-public)
- Liquity Core: compositional reference for `openTrove` / `closeTrove`
- Alchemix V2: compositional reference for `mint` / `burn` symmetry
