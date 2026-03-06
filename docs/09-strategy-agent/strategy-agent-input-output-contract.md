# Strategy Agent Input/Output Contract

## Agent Input

The Strategy Agent receives context from the LangGraph state and user messages.

### From Semantic Router

```json
{
  "intent": "STRATEGY",
  "confidence": 0.85,
  "raw_message": "I want to invest $5000 in something safe"
}
```

### From User Session

```json
{
  "user_id": "string",
  "session_id": "string",
  "wallet_address": "0x...",
  "connected_chains": ["base", "avalanche"],
  "token_balances": {
    "USDC": "5000.00",
    "ETH": "1.5",
    "AVAX": "100.0"
  }
}
```

### Collected During Conversation

```json
{
  "amount": 5000,
  "risk_preference": "conservative",
  "target_chain": "avalanche",
  "intent_type": "yield",
  "preferred_protocol": null,
  "time_horizon": null
}
```

## Agent Output

### Strategy Proposal (to Gateway/User)

Emitted as agent response metadata alongside the natural language message.

```json
{
  "type": "strategy_proposal",
  "proposals": [
    {
      "strategy_id": "stable_yield_v1",
      "strategy_name": "Stable Yield",
      "risk_level": "low",
      "estimated_apy": "3-5%",
      "summary": "Supply USDC to Benqi on Avalanche",
      "steps_count": 1,
      "warnings": ["Smart contract risk", "Variable APY"]
    },
    {
      "strategy_id": "avax_yield_v1",
      "strategy_name": "AVAX Yield",
      "risk_level": "low-moderate",
      "estimated_apy": "2-6%",
      "summary": "Supply AVAX to Benqi on Avalanche",
      "steps_count": 1,
      "warnings": ["Smart contract risk", "AVAX price exposure"]
    }
  ]
}
```

### Strategy Intent Ready (to Gateway)

Emitted when user selects a strategy. Gateway uses this to build action buttons.

```json
{
  "type": "strategy_intent_ready",
  "strategy_id": "stable_yield_v1",
  "user_address": "0x...",
  "params": {
    "amount": "5000",
    "token": "USDC",
    "chain": "avalanche",
    "protocol": "benqi"
  },
  "execution_steps": [
    {
      "step": 1,
      "action": "supply",
      "service": "lending-service",
      "endpoint": "POST /lending/supply",
      "params": {
        "token": "USDC",
        "amount": "5000",
        "chain": "avalanche",
        "protocol": "benqi"
      }
    }
  ]
}
```

### Multi-Step Example (Liquidity Provision)

```json
{
  "type": "strategy_intent_ready",
  "strategy_id": "liquidity_provision_v1",
  "user_address": "0x...",
  "params": {
    "amount": "2000",
    "chain": "base",
    "pool": "ETH/USDC"
  },
  "execution_steps": [
    {
      "step": 1,
      "action": "swap",
      "service": "execution-service",
      "endpoint": "POST /execution/prepare-swap",
      "params": {
        "tokenIn": "0x4200000000000000000000000000000000000006",
        "tokenOut": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
        "amountIn": "1000000000000000000",
        "protocolId": "aerodrome"
      },
      "depends_on": null
    },
    {
      "step": 2,
      "action": "addLiquidity",
      "service": "execution-service",
      "endpoint": "POST /execution/prepare-liquidity",
      "params": {
        "tokenA": "0x4200000000000000000000000000000000000006",
        "tokenB": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
        "amountA": "500000000000000000",
        "amountB": "auto",
        "stable": false,
        "protocolId": "aerodrome"
      },
      "depends_on": 1
    },
    {
      "step": 3,
      "action": "stake",
      "service": "execution-service",
      "endpoint": "POST /execution/prepare-stake",
      "params": {
        "lpToken": "auto",
        "amount": "auto",
        "protocolId": "aerodrome"
      },
      "depends_on": 2
    }
  ]
}
```

## Gateway Handling

### Single-Step Strategy
Gateway receives `strategy_intent_ready`, builds one action button:
```
[Execute: Supply USDC to Benqi] -> MiniApp deep link with params
```

### Multi-Step Strategy
Gateway receives `strategy_intent_ready` with multiple steps. Two options:

**Option A**: Single button, MiniApp handles step sequencing
```
[Execute Strategy: Liquidity Provision] -> MiniApp multi-step execution page
```

**Option B**: Sequential buttons (one per step)
```
[Step 1: Swap ETH to USDC] -> MiniApp swap page
[Step 2: Add Liquidity] -> MiniApp LP page (enabled after step 1)
[Step 3: Stake LP] -> MiniApp stake page (enabled after step 2)
```

Recommended: **Option A** for better UX. MiniApp shows a step-by-step wizard.

## Error Responses

### No Strategy Found
```json
{
  "type": "strategy_no_match",
  "reason": "No strategies available for aggressive risk on Polygon",
  "suggestions": ["Try Base or Avalanche", "Lower risk tolerance"]
}
```

### Insufficient Balance
```json
{
  "type": "strategy_insufficient_balance",
  "required": { "USDC": "5000" },
  "available": { "USDC": "2500" },
  "suggestion": "Reduce amount to $2500 or add funds"
}
```

### Execution Step Failed
```json
{
  "type": "strategy_step_failed",
  "strategy_id": "liquidity_provision_v1",
  "failed_step": 2,
  "completed_steps": [1],
  "error": "Slippage exceeded on addLiquidity",
  "recovery": "You can retry step 2 or remove the position from step 1"
}
```

## State Storage

Strategy intent is stored in the agent's session state (similar to SwapStateRepository):

```python
@dataclass
class StrategyIntent:
    strategy_id: str
    user_address: str
    amount: float
    risk_preference: str
    target_chain: str
    selected_strategy: Optional[str]
    execution_steps: List[dict]
    completed_steps: List[int]
    status: str  # collecting | proposed | selected | executing | completed | failed
```

The `StrategyStateRepository` persists this across conversation turns, enabling the agent to resume context if the user returns after interruption.
