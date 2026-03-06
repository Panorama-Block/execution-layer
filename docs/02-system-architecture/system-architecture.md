# System Architecture

## Overview

PanoramaBlock is a five-layer system: User Interface, Agent Intelligence, Backend Services, Execution Layer, and DeFi Protocols.

## Layer 1: User Interface

### Telegram Bot Gateway (apps/gateway)
- Runtime: Fastify + grammy
- Receives Telegram webhook events
- Forwards user messages to Agents API
- Detects intent-ready events and builds inline keyboards with WebApp buttons
- Routes: POST /webhook, GET /health, GET /metrics
- Metrics: Prometheus (totalMessages, totalUsers, totalChats, totalActions, totalErrors)

### MiniApp Frontend (apps/miniapp)
- Runtime: Next.js 15, React 19
- State management: Zustand
- Styling: Tailwind CSS
- Wallet: Thirdweb SDK (EVM), TonConnect (TON)
- Auth: Telegram WebApp initData signature verification
- Pages: /swap, /staking, /lending, /dca, /portfolio, /execution (new)

## Layer 2: Agent Intelligence

### Zico Agents (zico_agents/new_zico)
- Runtime: Python, FastAPI
- LLM: Google Gemini 2.5 Flash (default), Gemini 3 Flash Preview (reasoning)
- Embeddings: Google Gemini Embedding 001
- Framework: LangGraph StateGraph

### StateGraph Nodes
1. **entry_node** - Zero LLM calls. Context windowing, DeFi state lookup, message building.
2. **semantic_router_node** - Embedding-based intent classification. Cosine similarity against exemplar embeddings. HIGH_CONFIDENCE=0.78, LOW_CONFIDENCE=0.50.
3. **llm_router_node** - LLM fallback when confidence is between 0.50 and 0.78.
4. **Agent nodes** (9 variants) - Execute agent.invoke() with tools.
5. **formatter_node** - Mode-aware output formatting (fast vs reasoning).

### Agents
| Agent | Tools | State Repository |
|-------|-------|-----------------|
| swap_agent | update_swap_intent, list_tokens, list_networks | SwapStateRepository |
| lending_agent | update_lending_intent | LendingStateRepository |
| staking_agent | update_staking_intent | StakingStateRepository |
| dca_agent | update_dca_intent | DcaStateRepository |
| execution_agent (NEW) | update_execution_intent | ExecutionStateRepository |
| crypto_data_agent | get_price, get_market_data | - |
| portfolio_advisor | analyze_portfolio | - |
| search_agent | web_search | - |
| default_agent | - | - |

## Layer 3: Backend Services

9 microservices orchestrated via Docker Compose:

| Service | Port | Stack | Protocol Integration |
|---------|------|-------|---------------------|
| auth-service | 3001 | Express, ThirdWeb SDK | JWT, SIWE |
| liquid-swap-service | 3002 | Express | Uniswap Trading API, Thirdweb Bridge |
| bridge-service | 3003 | Express | LayerZero, Layerswap |
| lido-service | 3004 | Express | Lido (Ethereum) |
| database gateway | 3005 | Fastify, Prisma | PostgreSQL |
| lending-service | 3006 | Express | Benqi (Avalanche) |
| dca-service | 3007 | Express | ERC-4337 AA |
| execution-service | 3010 | Express (NEW) | Aerodrome (Base) |
| wallet-tracker | - | Go | Multi-chain RPC |

### Infrastructure
- PostgreSQL: persistent storage via Prisma ORM
- Redis: caching, DCA scheduling
- Docker Compose: service orchestration

## Layer 4: Execution Layer

### On-Chain Contracts
- PanoramaExecutor.sol: core entry point, adapter registry
- AerodromeAdapter.sol: Aerodrome protocol wrapper
- Deployed on Base (chain ID 8453)

### Pattern
User approves tokens to PanoramaExecutor -> calls execute function -> executor delegates to registered adapter -> adapter calls protocol -> tokens return to user.

## Layer 5: DeFi Protocols

| Protocol | Chain | Operations |
|----------|-------|-----------|
| Aerodrome Finance | Base | Swaps, liquidity, LP staking |
| Lido | Ethereum | ETH staking (stETH) |
| Benqi | Avalanche | Supply, borrow, repay, withdraw |
| Uniswap (via API) | Multi-chain | Swap routing |
| Layerswap | Multi-chain | Cross-chain bridging |

## Communication Patterns

```
User -> Telegram API -> Bot Gateway -> Agents API (HTTP, 45s timeout)
Agents API -> Backend Services (HTTP, JWT service tokens)
MiniApp -> Backend Services (HTTP, Bearer token)
MiniApp -> Blockchain (Thirdweb SDK, direct tx signing)
Backend -> Blockchain (ethers.js, RPC calls for reads)
Executor -> Adapter -> Protocol (on-chain delegatecall pattern)
```
