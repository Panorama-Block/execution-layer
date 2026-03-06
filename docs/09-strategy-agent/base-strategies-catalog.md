# Base Strategies Catalog

5 initial strategies for PanoramaBlock's Strategy Agent.

---

## 1. Stable Yield

| Field | Value |
|-------|-------|
| ID | `stable_yield_v1` |
| Intent Type | yield |
| Risk Level | Low |
| Profiles | Conservative, Moderate |
| Chain | Avalanche |
| Protocol | Benqi |

**What it does**: Supplies stablecoins (USDC) to Benqi lending protocol. Earns interest from borrowers.

**Execution Steps**:
1. Supply USDC to Benqi (`lending-service /supply`)

**Expected Outcome**: 3-5% APY, withdrawable anytime

**Risk Factors**:
- Smart contract risk
- Variable APY based on utilization
- Stablecoin depeg risk

**Best For**: Users who want low-risk yield on idle stablecoins with instant liquidity.

---

## 2. ETH Long-Term Staking

| Field | Value |
|-------|-------|
| ID | `eth_staking_v1` |
| Intent Type | staking |
| Risk Level | Low |
| Profiles | Conservative, Moderate |
| Chain | Ethereum |
| Protocol | Lido |

**What it does**: Stakes ETH via Lido to receive stETH. Earns Ethereum staking rewards.

**Execution Steps**:
1. Stake ETH via Lido (`lido-service /stake`)

**Expected Outcome**: 3-4% APY, liquid staking (stETH tradeable)

**Risk Factors**:
- Smart contract risk (Lido)
- Validator slashing risk (rare)
- stETH/ETH price deviation risk

**Best For**: ETH holders who want passive yield without selling their position. Long-term horizon.

---

## 3. AVAX Yield

| Field | Value |
|-------|-------|
| ID | `avax_yield_v1` |
| Intent Type | yield |
| Risk Level | Low-Moderate |
| Profiles | Moderate |
| Chain | Avalanche |
| Protocol | Benqi |

**What it does**: Supplies AVAX to Benqi lending protocol. Earns interest from borrowers plus potential QI rewards.

**Execution Steps**:
1. Supply AVAX to Benqi (`lending-service /supply`)

**Expected Outcome**: 2-6% APY (base + rewards), withdrawable anytime

**Risk Factors**:
- Smart contract risk
- AVAX price exposure (non-stablecoin)
- Variable APY
- QI reward token value fluctuation

**Best For**: AVAX holders who want yield on their native token without additional price exposure.

---

## 4. DCA Accumulation

| Field | Value |
|-------|-------|
| ID | `dca_accumulation_v1` |
| Intent Type | accumulation |
| Risk Level | Variable |
| Profiles | Conservative, Moderate, Aggressive |
| Chain | Multi-chain |
| Protocol | Various (swap protocols) |

**What it does**: Sets up recurring purchases of a target asset (ETH, BTC, etc.) at regular intervals. Averages entry price over time.

**Execution Steps**:
1. Create DCA order (`dca-service /create`)
   - Specifies: source token, target token, amount per interval, frequency

**Expected Outcome**: Automated accumulation, reduced timing risk

**Risk Factors**:
- Target asset price risk (could decline)
- Gas costs per execution
- Slippage on each swap
- DCA service availability

**Best For**: Users who want to build a position in an asset over time without trying to time the market.

**Configuration Options**:
- Frequency: daily, weekly, biweekly, monthly
- Amount per interval: user-defined
- Target asset: ETH, BTC, AVAX, etc.
- Duration: indefinite or fixed number of executions

---

## 5. Liquidity Provision

| Field | Value |
|-------|-------|
| ID | `liquidity_provision_v1` |
| Intent Type | liquidity |
| Risk Level | Moderate |
| Profiles | Moderate, Aggressive |
| Chain | Base |
| Protocol | Aerodrome |

**What it does**: Provides liquidity to an Aerodrome pool and stakes LP tokens in the gauge for AERO rewards.

**Execution Steps**:
1. Swap half of input to second token (`execution-service /prepare-swap`)
2. Add liquidity to pool (`execution-service /prepare-liquidity`)
3. Stake LP tokens in gauge (`execution-service /prepare-stake`)

**Expected Outcome**: 10-30% APY (fees + AERO emissions), variable

**Risk Factors**:
- Impermanent loss (significant if token prices diverge)
- Smart contract risk (Aerodrome)
- AERO token value fluctuation
- Pool liquidity concentration risk
- Multi-step execution (3 transactions)

**Best For**: Experienced users comfortable with impermanent loss who want higher yields through active liquidity provision.

---

## Strategy Comparison

| Strategy | Risk | APY Range | Steps | Liquidity | Complexity |
|----------|------|-----------|-------|-----------|------------|
| Stable Yield | Low | 3-5% | 1 | High | Simple |
| ETH Staking | Low | 3-4% | 1 | High (stETH) | Simple |
| AVAX Yield | Low-Mod | 2-6% | 1 | High | Simple |
| DCA | Variable | N/A | 1 (recurring) | N/A | Simple |
| Liquidity | Moderate | 10-30% | 3 | Medium | Complex |

## Strategy Selection Logic

```
User says "I want yield" + risk = conservative
  -> Stable Yield, ETH Staking

User says "I want yield" + risk = moderate
  -> Stable Yield, AVAX Yield, Liquidity Provision

User says "help me invest" + no risk preference
  -> Ask about risk tolerance, then match

User says "I want to accumulate ETH"
  -> DCA Accumulation (target: ETH)

User says "I have ETH and want yield"
  -> ETH Staking (simplest), Liquidity Provision (higher yield)
```
