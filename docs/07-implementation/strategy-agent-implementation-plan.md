# Strategy Agent Implementation Plan

## Phase 1: Strategy Definition Layer

### Strategy Block Schema
Define the normalized structure for strategy definitions:

```json
{
  "strategy_id": "stable_yield_v1",
  "strategy_name": "Stable Yield",
  "user_intent_type": "yield",
  "supported_profiles": ["conservative", "moderate"],
  "risk_level": "low",
  "required_inputs": ["amount", "target_chain"],
  "optional_inputs": ["preferred_protocol", "max_duration"],
  "execution_steps": [
    {"action": "supply", "protocol": "benqi", "params": {"token": "USDC"}}
  ],
  "protocols_used": ["benqi"],
  "chain_support": ["avalanche"],
  "estimated_outcomes": {"apy_range": "3-5%"},
  "warnings": ["Smart contract risk", "Variable APY"],
  "failure_conditions": ["Insufficient balance", "Protocol paused"],
  "educational_copy": "This strategy supplies stablecoins to a lending protocol..."
}
```

### Tasks
- [ ] Define strategy block schema (all fields)
- [ ] Review Gustavo's strategy block document
- [ ] Normalize fields for backend usage
- [ ] Define required vs optional inputs
- [ ] Define risk labels (low, moderate, high)

## Phase 2: Base Strategies

5 initial strategies:

1. **Stable Yield**: Supply stablecoins to lending protocol. Low risk. Benqi/Moonwell.
2. **ETH Long-Term Staking**: Stake ETH via Lido. Low risk. Ethereum.
3. **AVAX Yield**: Supply AVAX to Benqi. Low-moderate risk. Avalanche.
4. **DCA Accumulation**: Recurring buys of target asset. Variable risk. Multi-chain.
5. **Liquidity Provision**: Provide LP + stake in gauge. Moderate risk. Aerodrome.

### Tasks
- [ ] Write strategy block for each of the 5 strategies
- [ ] Define execution steps with backend service mapping
- [ ] Define risk parameters and warnings
- [ ] Write educational copy for each strategy

## Phase 3: Agent Logic

### Intent Classification
Extend semantic router to detect strategy intents:
- "I want yield" -> STRATEGY
- "Help me invest $5000" -> STRATEGY
- "What should I do with my ETH?" -> STRATEGY

### Missing Information Extraction
Strategy Agent asks for:
- Available capital
- Risk preference
- Target chain (or auto-detect from wallet)
- Time horizon
- Specific preferences

### Multi-Strategy Proposal
Agent may propose multiple strategies:
- "Option A: Conservative (supply USDC, 4% APY)"
- "Option B: Moderate (LP + stake, 12% APY with IL risk)"

User selects preferred option.

### Tasks
- [ ] Add STRATEGY intent category to semantic router
- [ ] Create strategy_agent with tools
- [ ] Implement strategy matching logic
- [ ] Implement multi-strategy proposal generation
- [ ] Add explanation layer (why this strategy)

## Phase 4: Backend Integration

### Output Contract
Strategy Agent produces structured output:
```json
{
  "strategy_id": "liquidity_v1",
  "steps": [
    {"action": "swap", "service": "execution-service", "params": {...}},
    {"action": "addLiquidity", "service": "execution-service", "params": {...}},
    {"action": "stake", "service": "execution-service", "params": {...}}
  ]
}
```

### Tasks
- [ ] Define output contract (JSON schema)
- [ ] Map strategy actions to backend services
- [ ] Implement step sequencing
- [ ] Handle partial execution failures
- [ ] Define fallback behavior for unsupported paths
