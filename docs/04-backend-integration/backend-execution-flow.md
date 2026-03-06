# Backend Execution Flow

## Execution Service (Port 3010)

New standalone microservice that prepares transaction calldata for the execution layer. Does not modify existing services.

## API Endpoints

### POST /execution/pools
Find available pools for a token pair.

Request:
```json
{
  "chainId": 8453,
  "tokenA": "0x4200000000000000000000000000000000000006",
  "tokenB": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"
}
```

Response:
```json
{
  "pools": [
    {
      "address": "0x...",
      "tokenA": "WETH",
      "tokenB": "USDC",
      "stable": false,
      "tvl": "15000000",
      "fee": "0.3%"
    }
  ]
}
```

### POST /execution/quote
Get expected output for a swap.

Request:
```json
{
  "chainId": 8453,
  "tokenIn": "0x0000000000000000000000000000000000000000",
  "tokenOut": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  "amountIn": "100000000000000000"
}
```

Response:
```json
{
  "amountOut": "250120000",
  "priceImpact": "0.02",
  "route": [{"from": "WETH", "to": "USDC", "stable": false}]
}
```

### POST /execution/prepare-swap
Prepare swap transaction(s) for frontend signing.

Request:
```json
{
  "chainId": 8453,
  "tokenIn": "0x0000000000000000000000000000000000000000",
  "tokenOut": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  "amountIn": "100000000000000000",
  "slippageBps": 50,
  "sender": "0xUSER..."
}
```

Response:
```json
{
  "transactions": [
    {
      "to": "0xEXECUTOR",
      "data": "0x...",
      "value": "100000000000000000",
      "chainId": 8453
    }
  ],
  "metadata": {
    "protocol": "aerodrome",
    "pool": "0x...",
    "poolType": "volatile",
    "estimatedOutput": "250120000",
    "minimumOutput": "248869400"
  }
}
```

### POST /execution/prepare-liquidity
Prepare add/remove liquidity transactions. Similar request/response pattern.

### POST /execution/prepare-stake
Prepare stake/unstake LP token transactions.

### GET /execution/positions/:address
Get user's LP positions and gauge stakes on the target chain.

## Prepare-Swap Flow (Internal)

1. **Receive parameters** - chainId, tokenIn, tokenOut, amountIn, slippageBps, sender
2. **Resolve chain config** - Look up RPC URL, executor address, protocol addresses
3. **Query pool** - Call Aerodrome factory to find pool (volatile vs stable)
4. **Get quote** - Call router.getAmountsOut() on-chain via ethers.js
5. **Calculate slippage** - amountOutMin = amountOut * (10000 - slippageBps) / 10000
6. **Encode calldata** - Encode PanoramaExecutor.executeSwap() with all parameters
7. **Check approval** - If tokenIn is ERC20, check allowance. If insufficient, prepend approve tx.
8. **Return PreparedTx[]** - Array of transactions for frontend to sign sequentially

## Response Format

Matches the existing PreparedTx pattern used by liquid-swap-service, ensuring the same frontend signing flow (safeExecuteTransactionV2) works without modification.

## Error Handling

- 400: Invalid parameters (Zod validation)
- 404: Pool not found for token pair
- 500: RPC error, encoding error
- Rate limiting via middleware

## Docker Integration

Added to panorama-block-backend/docker-compose.yml:
```yaml
execution_service:
  build:
    context: ../panoramablock-execution-layer/backend
  ports:
    - "${EXECUTION_PORT:-3010}:3010"
  environment:
    - PORT=3010
    - BASE_RPC_URL=${BASE_RPC_URL}
    - EXECUTOR_ADDRESS=${EXECUTOR_ADDRESS}
```
