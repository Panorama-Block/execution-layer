# Strategy Agent Scope

## What It Does

### Intent Interpretation
- Receives natural language goals from users
- Classifies intent type: yield, staking, accumulation, liquidity, hedging
- Extracts parameters: amount, risk preference, chain, time horizon

### Strategy Matching
- Filters available strategies by user profile
- Ranks strategies by fit (risk alignment, chain availability, capital requirements)
- Handles edge cases: no matching strategy, insufficient capital, unsupported chain

### Proposal Generation
- Generates 1-3 strategy options per request
- Each option includes: name, risk level, expected outcome range, steps, warnings
- Provides educational explanation for each option
- Asks user to select preferred option

### Execution Planning
- Converts selected strategy into ordered execution steps
- Each step maps to a backend service endpoint
- Produces structured output (JSON) for the execution pipeline

### Information Collection
- Detects missing required inputs
- Asks natural follow-up questions to fill gaps
- Supports "I don't know" responses with sensible defaults
- Validates inputs before proceeding

## What It Does NOT Do

### No Position Management
- Does not monitor positions after creation
- Does not auto-rebalance or auto-compound
- Does not alert on position changes (APY drops, health factor warnings)
- Future: Position tracking and alerts are Phase 4+ features

### No Autonomous Execution
- Never executes without user confirmation
- Always presents strategy details before execution
- User must explicitly approve each strategy

### No Cross-Chain Operations
- Strategies are single-chain in v1
- Does not bridge assets between chains
- Does not coordinate execution across multiple chains
- Future: Cross-chain strategies in Phase 3

### No Return Predictions
- APY ranges are informational, based on current protocol data
- Does not forecast future returns
- Does not guarantee outcomes
- Includes appropriate disclaimers

### No Custom Strategy Creation
- Users cannot define custom strategies in v1
- Strategies are pre-defined by the team
- Future: User-defined strategy templates

## Boundaries

### With Execution Layer
- Strategy Agent **proposes**; Execution Layer **executes**
- Strategy Agent outputs structured JSON; execution-service encodes calldata
- Strategy Agent does not interact with smart contracts directly

### With Single-Action Agents
- If user wants a single swap, that goes to swap_agent (not strategy_agent)
- If user wants to stake ETH, that goes to staking_agent
- Strategy Agent handles composite goals: "invest $5000 for yield" (may involve multiple actions)
- Semantic router makes the classification

### With Frontend
- Strategy Agent communicates via the gateway (Telegram bot)
- Frontend receives execution steps (PreparedTx[]) after user confirms
- Frontend handles signing and transaction tracking
- Strategy Agent does not control UI rendering

## Supported Chains (v1)

| Chain | Protocols | Strategies |
|-------|-----------|------------|
| Base | Aerodrome | Liquidity Provision |
| Avalanche | Benqi | Stable Yield, AVAX Yield |
| Ethereum | Lido | ETH Staking |
| Multi-chain | Various | DCA Accumulation |
