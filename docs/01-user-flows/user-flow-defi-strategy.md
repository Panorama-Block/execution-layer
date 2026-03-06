# User Flow: DeFi Strategy Execution

## Overview

Multi-protocol strategy flow where the Strategy Agent decomposes a user's financial goal into a sequence of DeFi operations across multiple protocols, then orchestrates execution.

## Example Scenario

User: "I want to earn yield on $5000 with moderate risk on Base"

## Flow

### Step 1: Intent Expression

User sends natural language goal to chat. No specific protocol or action mentioned.

### Step 2: Strategy Agent Analysis

The Strategy Agent:
- Identifies risk profile: moderate
- Identifies available capital: $5000
- Identifies target chain: Base
- Queries available protocols on Base (Aerodrome, Moonwell, Avantis)
- Evaluates current yields and conditions

### Step 3: Strategy Proposal

Agent constructs and presents a multi-step strategy:

```
Proposed Strategy: Moderate Yield on Base

1. Swap $2,500 USDC -> WETH via Aerodrome (volatile pool)
2. Supply $2,500 USDC as collateral on Moonwell (earn supply APY)
3. Add WETH/USDC liquidity on Aerodrome (earn swap fees)
4. Stake LP tokens in Aerodrome gauge (earn AERO rewards)

Expected combined APY: ~12-18%
Risk: moderate (impermanent loss, smart contract risk)
```

### Step 4: User Approval

User reviews the strategy and approves execution.

### Step 5: Sequential Execution

Each step executes as a separate transaction through the execution layer:

**Step 5a: Swap**
- execution-service prepares swap calldata
- User signs: PanoramaExecutor.executeSwap(aerodrome, USDC, WETH, 2500, ...)
- Result: ~0.83 WETH received

**Step 5b: Supply Collateral**
- lending-service prepares supply calldata (if Moonwell adapter exists)
- Or direct Moonwell interaction
- Result: mUSDC minted to user

**Step 5c: Add Liquidity**
- execution-service prepares addLiquidity calldata
- User signs: PanoramaExecutor.executeAddLiquidity(aerodrome, WETH, USDC, false, ...)
- Result: LP tokens received

**Step 5d: Stake LP**
- execution-service prepares stake calldata
- User signs: PanoramaExecutor.executeStake(aerodrome, lpToken, amount, gaugeData)
- Result: LP tokens staked, earning AERO rewards

### Step 6: Confirmation

Agent summarizes completed strategy:
- $2,500 USDC supplied on Moonwell
- WETH/USDC LP staked on Aerodrome
- Earning: supply APY + swap fees + AERO rewards

### Step 7: Ongoing Monitoring

User can check strategy performance via portfolio view. Agent can suggest rebalancing if conditions change.

## Future Enhancements

- Atomic multi-step execution (batch all steps in one tx)
- Auto-rebalancing based on market conditions
- Stop-loss and take-profit triggers
- Strategy templates for common goals
