# Strategy Agent Overview

## Purpose

The Strategy Agent is PanoramaBlock's intelligence layer for DeFi strategy recommendation and execution. Instead of requiring users to understand individual DeFi operations (swap, stake, supply, LP), the Strategy Agent interprets user goals and maps them to multi-step execution plans.

## Core Function

```
User Intent -> Strategy Agent -> Strategy Proposal -> Execution Steps -> On-Chain Actions
```

1. **Understand**: Parse natural language goals ("I want safe yield on my USDC")
2. **Match**: Find strategies that fit user's profile (risk tolerance, capital, chain)
3. **Propose**: Present 1-3 options with clear risk/reward tradeoffs
4. **Execute**: Convert selected strategy into ordered execution steps

## Current Status

- **Phase**: Definition and design
- **Strategy blocks**: 5 base strategies defined (Stable Yield, ETH Staking, AVAX Yield, DCA, Liquidity)
- **Agent implementation**: Not yet started (depends on execution layer MVP)
- **Backend integration**: Design phase

## Relationship to Other Components

### Execution Layer
The Strategy Agent is a **consumer** of the execution layer. Each strategy step maps to an execution-service endpoint:
- `swap` -> POST /execution/prepare-swap
- `supply` -> lending-service /supply
- `stake` -> lido-service /stake or execution-service /prepare-stake
- `addLiquidity` -> POST /execution/prepare-liquidity

### Semantic Router
The Strategy Agent is triggered by the semantic router when it classifies user intent as `STRATEGY`. This is distinct from `SWAP`, `STAKE`, or `LENDING` intents which go to single-action agents.

### Onboarding
For new users, the Strategy Agent can serve as a guided entry point: "What do you want to achieve with DeFi?" leads to a strategy recommendation that doubles as education.

## Key Design Decisions

1. **Strategy blocks are static definitions**: They don't change per user. The agent selects and parameterizes them based on user input.
2. **Multi-step execution is sequential**: Each step must succeed before the next begins. Partial execution is handled gracefully.
3. **Risk is explicit**: Every strategy has a risk level and warnings. The agent always communicates risk before execution.
4. **Educational by default**: Strategy proposals include explanations of what each step does and why.

## What the Strategy Agent Does NOT Do

- It does not manage positions after creation (no auto-rebalancing in v1)
- It does not predict returns (APY ranges are informational, not guaranteed)
- It does not handle cross-chain bridging (strategies are single-chain in v1)
- It does not make investment decisions autonomously (user must confirm)
