# Strategy Agent Decision Logic

## Overview

The Strategy Agent follows a structured decision process: classify intent, collect missing information, match strategies, propose options, and hand off to execution.

## Intent Classification

The semantic router detects STRATEGY intent using embedding similarity:

```
Utterances:
- "I want yield"
- "Help me invest"
- "What should I do with my ETH?"
- "I have $5000, how can I earn?"
- "Recommend a DeFi strategy"
- "I want passive income from crypto"
- "What's the best way to use my USDC?"
- "Help me earn on my tokens"

Confidence thresholds:
- HIGH (>= 0.78): Route directly to strategy_agent
- MEDIUM (0.50 - 0.78): Route with low confidence flag
- LOW (< 0.50): Route to general_agent
```

### Disambiguation

Some intents overlap with single-action agents:
- "I want to stake ETH" -> STAKING (single action, goes to staking_agent)
- "What's the best way to use my ETH?" -> STRATEGY (needs recommendation)
- "Swap USDC for ETH" -> SWAP (single action, goes to swap_agent)
- "Help me invest in ETH" -> STRATEGY (needs recommendation)

The key differentiator: **strategy intents express a goal, not a specific action**.

## Information Collection

### Required Information

| Field | Question | Default |
|-------|----------|---------|
| amount | "How much would you like to invest?" | None (must ask) |
| risk_preference | "What's your risk tolerance? (conservative / moderate / aggressive)" | moderate |
| target_chain | "Which chain do you prefer?" | Auto-detect from wallet |

### Optional Information

| Field | Question | Default |
|-------|----------|---------|
| preferred_protocol | "Do you have a preferred protocol?" | Best match |
| time_horizon | "How long do you plan to hold?" | No constraint |
| specific_asset | "Is there a specific asset you want to use?" | Flexible |

### Collection Flow

```
1. User: "Help me invest $5000"
   Agent extracts: amount = $5000
   Agent needs: risk_preference, target_chain

2. Agent: "I'd be happy to help you invest $5000.
   To recommend the best strategy, I need to know:
   - What's your risk tolerance? (conservative, moderate, or aggressive)
   - Which chain do you prefer? (Base, Avalanche, Ethereum)"

3. User: "I'm conservative, Avalanche is fine"
   Agent extracts: risk = conservative, chain = avalanche

4. Agent proceeds to strategy matching
```

### Handling Uncertainty

If user says "I don't know" to risk preference:
- Default to **moderate**
- Explain: "I'll suggest moderate-risk options. These balance yield and safety."

If user doesn't specify chain:
- Check wallet for connected chains
- If multi-chain, suggest the chain with best options for their profile
- If no wallet, ask explicitly

## Strategy Matching Algorithm

```python
def match_strategies(user_profile):
    candidates = []

    for strategy in ALL_STRATEGIES:
        # Filter by chain support
        if user_profile.chain not in strategy.chain_support:
            continue

        # Filter by risk profile
        if user_profile.risk not in strategy.supported_profiles:
            continue

        # Filter by minimum capital (if applicable)
        if strategy.min_capital and user_profile.amount < strategy.min_capital:
            continue

        # Filter by intent type (if user specified)
        if user_profile.intent_type and strategy.user_intent_type != user_profile.intent_type:
            continue

        candidates.append(strategy)

    # Rank by fit
    ranked = rank_by_fit(candidates, user_profile)

    # Return top 2-3
    return ranked[:3]
```

### Ranking Criteria

1. **Risk alignment**: Strategies matching exact risk level rank higher
2. **Simplicity**: Fewer execution steps rank higher (less can go wrong)
3. **Yield**: Higher estimated APY breaks ties
4. **Protocol maturity**: Established protocols rank higher

## Proposal Generation

### Single Strategy Proposal

When only one strategy matches:

```
I recommend **Stable Yield** for your profile:

- **What**: Supply $5,000 USDC to Benqi on Avalanche
- **Expected yield**: 3-5% APY
- **Risk**: Low (smart contract risk, variable rates)
- **Steps**: 1 transaction (supply USDC)
- **Liquidity**: Withdraw anytime

This strategy earns interest from borrowers on the Benqi lending
protocol. It's the safest yield option for stablecoins.

Would you like to proceed?
```

### Multi-Strategy Proposal

When multiple strategies match:

```
Based on your profile, here are your options:

**Option A: Stable Yield** (Conservative)
- Supply USDC to Benqi | 3-5% APY | Low risk
- 1 transaction | Withdraw anytime

**Option B: AVAX Yield** (Moderate)
- Supply AVAX to Benqi | 2-6% APY | Low-moderate risk
- 1 transaction | AVAX price exposure

**Option C: Liquidity Provision** (Moderate)
- LP on Aerodrome (Base) | 10-30% APY | Moderate risk
- 3 transactions | Impermanent loss risk

Which option interests you? I can explain any of these in more detail.
```

## Refusal Logic

The agent refuses or redirects when:

1. **No matching strategy**: "I don't have a strategy that fits your criteria. Could you adjust your chain preference or risk tolerance?"

2. **Amount too low**: "The minimum for this strategy is $100 due to gas costs. Would you like to increase your amount?"

3. **Unsupported chain**: "I don't support strategies on [chain] yet. I can suggest options on Base, Avalanche, or Ethereum."

4. **High risk + conservative profile**: "Liquidity provision involves impermanent loss risk. Since you indicated a conservative preference, I'd recommend Stable Yield instead. Would you like to hear about it?"

## Post-Selection Flow

After user selects a strategy:

1. Confirm selection with full details
2. Check failure conditions (balance, protocol status)
3. Generate execution steps as structured JSON
4. Emit `strategy_intent_ready` metadata
5. Gateway builds action button(s) for MiniApp
6. User executes each step in MiniApp (sign transactions)

```
User: "I'll go with Option A"

Agent: "Great choice! Here's your Stable Yield execution plan:

**Step 1**: Supply 5,000 USDC to Benqi on Avalanche
- Estimated APY: 3-5%
- You'll receive qiUSDC tokens representing your position

Tap the button below to execute in the app."

[Execute Strategy] -> MiniApp deep link
```
