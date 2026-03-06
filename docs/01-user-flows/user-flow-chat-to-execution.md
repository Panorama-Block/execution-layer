# User Flow: Chat to On-Chain Execution

## Overview

This document describes the complete flow from a user sending a chat message to an on-chain transaction being executed through the PanoramaBlock execution layer.

## Flow Steps

### Step 1: User Sends Message

The user sends a natural language message via Telegram chat.

Example: "Swap 0.1 ETH to USDC on Aerodrome"

### Step 2: Bot Gateway Receives Message

The Telegram Bot Gateway (Fastify + grammy) receives the message via webhook.

Processing:
- Extract chat_id, user text, metadata
- Resolve telegram_user_id to internal user_id via Identity Service
- Create conversation_id: `tgchat:{chatId}`
- Track metrics (totalMessages, totalUsers)

### Step 3: Forward to Agents API

The gateway sends an HTTP POST to the Zico Agents API:

```json
{
  "message": "Swap 0.1 ETH to USDC on Aerodrome",
  "user_id": "abc123",
  "conversation_id": "tgchat:789",
  "metadata": {
    "telegram_user_id": "456",
    "chat_id": "789",
    "username": "john",
    "timestamp": "2024-03-07T10:00:00Z"
  }
}
```

Timeout: 45 seconds (configurable via AGENTS_REQUEST_TIMEOUT_MS).

### Step 4: Semantic Routing

The agent layer classifies intent:

1. entry_node: Zero LLM calls. Loads conversation history, performs context windowing (8 recent messages), looks up existing DeFi state.
2. semantic_router_node: Generates embedding for user message. Computes cosine similarity against exemplar embeddings for each intent category.

Result: EXECUTION intent with confidence 0.91 (above 0.78 threshold). Routes directly to execution_agent.

### Step 5: Execution Agent Collects Intent

The execution_agent invokes `update_execution_intent` tool:

```python
update_execution_intent(
    operation="swap",
    token_a="ETH",
    token_b="USDC",
    amount=0.1,
    protocol="aerodrome",
    chain="base"
)
```

All fields provided in one message. Intent is complete.

### Step 6: Intent Ready Event

The agent emits metadata:

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
  "user_id": "abc123",
  "conversation_id": "tgchat:789"
}
```

### Step 7: Bot Builds Action Button

The gateway detects `execution_intent_ready` and builds a Telegram inline keyboard with a WebApp button:

URL: `/execution?conversation_id=tgchat:789&telegram_user_id=456&tma=1`

Message: "Ready to swap 0.1 ETH -> USDC via Aerodrome on Base" + [Review & Execute] button.

### Step 8: User Opens MiniApp

User taps [Review & Execute]. The MiniApp opens with pre-filled parameters from the URL.

### Step 9: Quote Request

The MiniApp calls the execution-service:

```
POST /execution/quote
{
  "chainId": 8453,
  "tokenIn": "0x0000000000000000000000000000000000000000",
  "tokenOut": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  "amountIn": "100000000000000000"
}
```

The backend queries Aerodrome Router2.getAmountsOut() and returns the expected output.

### Step 10: Transaction Preparation

User confirms. The MiniApp calls:

```
POST /execution/prepare-swap
{
  "chainId": 8453,
  "tokenIn": "0x0000...",
  "tokenOut": "0x8335...",
  "amountIn": "100000000000000000",
  "slippageBps": 50,
  "sender": "0xUSER..."
}
```

The backend encodes PanoramaExecutor.executeSwap() calldata and returns PreparedTx[].

### Step 11: Wallet Signs Transaction

The MiniApp uses `safeExecuteTransactionV2` with Thirdweb to sign and broadcast:

```typescript
const tx = prepareTransaction({
  client,
  chain: defineChain(8453),
  to: executorAddress,
  data: preparedTx.data,
  value: BigInt(preparedTx.value),
});
const result = await sendTransaction({ account, transaction: tx });
```

### Step 12: On-Chain Execution

The transaction executes on Base:

1. PanoramaExecutor.executeSwap() is called
2. Executor looks up AerodromeAdapter via adapter registry
3. ETH is forwarded to adapter
4. Adapter calls Aerodrome Router2.swapExactETHForTokens()
5. USDC is sent directly to the user's address
6. SwapExecuted event is emitted

### Step 13: Confirmation

The MiniApp tracks the transaction via the Gateway transaction API:

1. Create transaction record (status: created)
2. Add tx hash (status: submitted)
3. Wait for block confirmation (status: pending -> confirmed)
4. Extract output amount, gas fee, exchange rate
5. Display confirmation to user

### Step 14: User Sees Result

"Swap complete! Received 250.12 USDC"
