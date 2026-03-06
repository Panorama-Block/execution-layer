# Agent -> Backend -> Contract Flow

## Complete Flow

```
User Message
  |
  v
[1] Telegram Bot Gateway
  |
  v
[2] Zico Agents API (semantic routing -> execution_agent)
  |
  v
[3] execution_agent collects intent via update_execution_intent tool
  |
  v
[4] Intent complete -> execution_intent_ready event emitted
  |
  v
[5] Bot Gateway detects event, builds WebApp button
  |
  v
[6] User opens MiniApp with pre-filled params
  |
  v
[7] MiniApp calls execution-service (POST /execution/prepare-swap)
  |
  v
[8] Backend encodes PanoramaExecutor.executeSwap() calldata
  |
  v
[9] Frontend signs via Thirdweb wallet
  |
  v
[10] Transaction executes on-chain (Executor -> Adapter -> Aerodrome)
  |
  v
[11] Transaction tracked via Gateway API (created -> confirmed)
```

## Step Details

### [1-2] Message Routing
Bot gateway resolves user identity and forwards to agents API with conversation context.

### [3] Intent Collection
The execution_agent uses the `update_execution_intent` tool, following the same pattern as the swap agent:

```python
@tool("update_execution_intent")
def update_execution_intent_tool(
    operation: Optional[str] = None,  # swap, addLiquidity, removeLiquidity, stake, unstake
    token_a: Optional[str] = None,
    token_b: Optional[str] = None,
    amount: Optional[Decimal] = None,
    pool_type: Optional[str] = None,  # volatile, stable
    protocol: Optional[str] = None,   # aerodrome
    chain: Optional[str] = None,      # base
):
```

Collects fields incrementally across conversation turns. Asks follow-up questions for missing fields.

### [4] Event Metadata
When intent is complete, metadata is stored and emitted:

```json
{
  "event": "execution_intent_ready",
  "status": "ready",
  "operation": "swap",
  "token_a": "ETH",
  "token_b": "USDC",
  "amount": "0.1",
  "protocol": "aerodrome",
  "chain": "base",
  "pool_type": "volatile",
  "user_id": "abc123",
  "conversation_id": "tgchat:789"
}
```

### [5] Bot Action Button
Gateway detects `execution_intent_ready` in response metadata. Builds inline keyboard:
```
[Review & Execute] -> WebApp URL: /execution?conversation_id=...&operation=swap&token_a=ETH&token_b=USDC&amount=0.1&tma=1
```

### [6-7] MiniApp -> Backend
MiniApp opens with pre-filled params from URL. Calls execution-service for quote and preparation.

### [8] Calldata Encoding
Backend encodes the full executor call:
```typescript
const calldata = executorInterface.encodeFunctionData("executeSwap", [
  keccak256(toUtf8Bytes("aerodrome")),
  tokenInAddress,
  tokenOutAddress,
  amountIn,
  amountOutMin,
  extraData, // abi.encode(stable)
  deadline,
]);
```

### [9-10] Signing and Execution
Frontend signs using the existing safeExecuteTransactionV2 pattern. Transaction goes to PanoramaExecutor on Base.

### [11] Tracking
Transaction lifecycle tracked via existing Gateway transaction API:
- createTransaction (action: "swap", fromAsset, toAsset, fromAmount)
- addTxHash (hash, chainId, action)
- markConfirmed (outputAmount, gasFee)
