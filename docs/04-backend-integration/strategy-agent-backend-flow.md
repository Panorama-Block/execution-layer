# Strategy Agent Backend Flow

## Overview

The Strategy Agent decomposes multi-step financial strategies into individual backend service calls. Each action maps to a specific service.

## Strategy Decomposition

User goal: "Earn yield on $5000 with moderate risk on Base"

Strategy Agent output:
```json
{
  "strategy_name": "Moderate Base Yield",
  "steps": [
    {"action": "swap", "service": "execution-service", "params": {"tokenIn": "USDC", "tokenOut": "WETH", "amount": "2500"}},
    {"action": "supply", "service": "lending-service", "params": {"token": "USDC", "amount": "2500", "protocol": "moonwell"}},
    {"action": "addLiquidity", "service": "execution-service", "params": {"tokenA": "WETH", "tokenB": "USDC", "stable": false}},
    {"action": "stake", "service": "execution-service", "params": {"lpToken": "...", "gauge": "..."}}
  ]
}
```

## Action-to-Service Mapping

| Action | Backend Service | Port |
|--------|----------------|------|
| swap (Aerodrome) | execution-service | 3010 |
| addLiquidity | execution-service | 3010 |
| removeLiquidity | execution-service | 3010 |
| stake (LP gauge) | execution-service | 3010 |
| supply (Benqi) | lending-service | 3006 |
| borrow (Benqi) | lending-service | 3006 |
| stake (Lido) | lido-service | 3004 |
| swap (Uniswap) | liquid-swap-service | 3002 |
| bridge | bridge-service | 3003 |

## Execution Sequencing

Steps execute sequentially because each depends on the output of the previous:

1. Swap USDC -> WETH: need WETH balance before LP
2. Supply USDC to Moonwell: independent, could parallel with step 1
3. Add WETH/USDC liquidity: requires WETH from step 1
4. Stake LP tokens: requires LP tokens from step 3

The agent presents all steps upfront. The frontend executes them one by one, with user signing each transaction.

## Error Handling

### Partial Execution
If step 3 fails after steps 1-2 succeed:
- Steps 1-2 results are already on-chain (user has WETH and mTokens)
- Strategy is in partial state
- Agent can suggest recovery actions (retry step 3, or unwind steps 1-2)

### Insufficient Balance
If user lacks funds for a step:
- Detected during prepare phase (before signing)
- Agent adjusts amounts or suggests alternative

### Slippage Failure
If on-chain execution reverts due to slippage:
- Transaction reverts atomically (no partial swap)
- Frontend reports failure
- Agent suggests increasing slippage or waiting for better conditions

## State Management

Strategy execution state tracked per (user_id, conversation_id):
```python
{
  "strategy_id": "moderate_base_yield",
  "total_steps": 4,
  "completed_steps": 2,
  "current_step": 3,
  "step_results": [
    {"step": 1, "status": "confirmed", "txHash": "0x...", "output": "0.83 WETH"},
    {"step": 2, "status": "confirmed", "txHash": "0x...", "output": "2500 mUSDC"}
  ]
}
```

## Future: Batch Execution

Once the executor supports multi-step operations in a single transaction, the strategy agent can bundle all steps into one call, reducing the number of user signatures from N to 1.
