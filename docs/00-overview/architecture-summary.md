# Architecture Summary

## High-Level Architecture

```
+------------------------------------------------------------------+
|                        USER INTERFACES                           |
|                                                                  |
|   +---------------------+      +-----------------------------+  |
|   |   Telegram Bot       |      |   Telegram MiniApp          |  |
|   |   (Fastify Gateway)  |      |   (Next.js WebApp)          |  |
|   +----------+-----------+      +-------------+---------------+  |
|              |                                |                   |
|              |  /start, chat messages         |  WebApp actions   |
|              |                                |  Thirdweb wallet  |
+--------------+--------------------------------+------------------+
               |                                |
+--------------v--------------------------------v------------------+
|                        AI AGENT LAYER                            |
|                                                                  |
|   +----------------------------------------------------------+  |
|   |   zico_agents (Python / LangGraph)                        |  |
|   |                                                            |  |
|   |   User Message --> Embedding --> Semantic Router           |  |
|   |                                  (9 categories)            |  |
|   |                                  threshold: 0.78           |  |
|   |                                                            |  |
|   |   StateGraph --> Intent Collection --> Execution Plan      |  |
|   +----------------------------+-----------------------------+   |
|                                |                                 |
+--------------------------------+---------------------------------+
                                 |
+--------------------------------v---------------------------------+
|                     BACKEND SERVICES                             |
|                     (Node.js Microservices)                      |
|                                                                  |
|   +------------+  +------------+  +------------+  +----------+  |
|   | auth       |  | liquid-swap|  | bridge     |  | lido     |  |
|   | :3001      |  | :3002      |  | :3003      |  | :3004    |  |
|   +------------+  +------------+  +------------+  +----------+  |
|                                                                  |
|   +------------+  +------------+  +------------+  +----------+  |
|   | database   |  | lending    |  | dca        |  | avax     |  |
|   | (gateway)  |  | :3006      |  | :3007      |  |          |  |
|   +------------+  +------------+  +------------+  +----------+  |
|                                                                  |
|   +-------------------+                                          |
|   | wallet-tracker    |                                          |
|   | (Go)              |                                          |
|   +-------------------+                                          |
|                                                                  |
+--------------------------------+---------------------------------+
                                 |
+--------------------------------v---------------------------------+
|                     EXECUTION LAYER (Base)                       |
|                                                                  |
|   +---------------------------+  +---------------------------+  |
|   | PanoramaExecutor.sol       |  | AerodromeAdapter.sol      |  |
|   | (Multi-step orchestration) |  | (DEX integration)         |  |
|   +---------------------------+  +---------------------------+  |
|                                                                  |
+--------------------------------+---------------------------------+
                                 |
+--------------------------------v---------------------------------+
|                     ON-CHAIN PROTOCOLS                            |
|                                                                  |
|   Aerodrome (Base)     Lido (Ethereum)     Benqi (Avalanche)    |
|   Router2, Factory     stETH staking       Supply/Borrow        |
|   Voter, Gauges                                                  |
|                                                                  |
|   Uniswap   Aave   Compound   + future protocol adapters        |
+------------------------------------------------------------------+
```

## Layer Descriptions

### Layer 1: User Interface

The interface layer provides two entry points for users.

**Telegram Bot (Fastify Gateway)**
Receives user messages via Telegram's Bot API. Parses commands (`/start`, `/help`, inline buttons) and forwards natural language messages to the agent layer. Returns structured responses and, when execution is needed, generates deep links to the MiniApp.

**Telegram MiniApp (Next.js)**
A full web application embedded within Telegram's WebApp container. Provides rich UI for wallet management, transaction signing, portfolio viewing, and protocol-specific interfaces (staking, lending, swaps). Authenticates users via Telegram WebApp init data and connects wallets through Thirdweb.

### Layer 2: AI Agent Layer

**zico_agents (Python / LangGraph)**

The intelligence layer that converts natural language into structured execution plans.

| Component | Description |
|-----------|-------------|
| Semantic Router | Embedding-based intent classifier with 9 categories and 0.78 confidence threshold |
| StateGraph | LangGraph state machine managing conversation flow and multi-turn interactions |
| Intent Collector | Gathers required parameters through conversational follow-ups |
| Execution Planner | Translates validated intents into backend API calls or multi-step strategies |

**Intent Categories (9):**
Staking, Lending, Swaps, Bridge, DCA, Portfolio, Wallet Tracking, General DeFi Questions, Strategy

### Layer 3: Backend Services

Nine Node.js microservices, each handling a specific domain.

| Service | Port | Responsibility |
|---------|------|----------------|
| **auth** | 3001 | User authentication, session management, Telegram auth validation |
| **liquid-swap** | 3002 | Token swap routing, quote aggregation, swap transaction preparation |
| **bridge** | 3003 | Cross-chain bridge operations, route finding, bridge transaction preparation |
| **lido** | 3004 | Lido staking integration, stETH management, unstaking queue |
| **database** | gateway | Central data gateway, user profiles, transaction history, portfolio data |
| **lending** | 3006 | Benqi lending protocol integration, supply/borrow/repay operations |
| **dca** | 3007 | Dollar-cost averaging with ERC-4337 Account Abstraction, scheduled execution |
| **avax** | -- | Avalanche-specific operations and chain interactions |
| **wallet-tracker** | -- (Go) | Multi-chain balance aggregation, position tracking, portfolio computation |

### Layer 4: Execution Layer

Smart contracts deployed on Base that enable atomic multi-step DeFi execution.

| Contract | Purpose |
|----------|---------|
| **PanoramaExecutor.sol** | Receives execution plans as calldata, executes a sequence of protocol interactions atomically |
| **AerodromeAdapter.sol** | Aerodrome-specific adapter handling swaps via Router2, LP operations, gauge staking |

**Aerodrome Contract Addresses (Base):**
- Router2: `0xcF77a3Ba9A5CA399B7c97c74d54e5b1Beb874E43`
- Factory: `0x420D...`
- Voter: `0x1661...`

### Layer 5: On-Chain Protocols

The DeFi protocols that PanoramaBlock integrates with at the smart contract level.

| Protocol | Chain | Operations |
|----------|-------|------------|
| Aerodrome | Base | Swaps, liquidity provision, gauge staking |
| Lido | Ethereum | ETH staking, stETH/wstETH management |
| Benqi | Avalanche | Supply, borrow, repay, withdraw |

## Supported Chains

| Chain | Primary Use |
|-------|-------------|
| Ethereum | Staking (Lido), major DeFi protocols |
| Base | Execution layer, Aerodrome swaps/LP |
| Avalanche | Lending (Benqi), 10K user waitlist |
| Polygon | Swaps, portfolio tracking |
| Arbitrum | Swaps, portfolio tracking |
| Optimism | Swaps, portfolio tracking |
| BSC | Swaps, portfolio tracking |
| World Chain | Swaps, portfolio tracking |

## Technology Stack by Repository

### zico_agents

| Technology | Purpose |
|------------|---------|
| Python 3.x | Runtime |
| LangGraph | Agent orchestration (StateGraph) |
| LangChain | LLM integration, tool calling |
| Sentence Transformers | Embedding generation for semantic routing |
| FastAPI | API server exposing agent endpoints |

### panorama-block-backend

| Technology | Purpose |
|------------|---------|
| Node.js | Runtime for 8 microservices |
| TypeScript | Primary language |
| Express / Fastify | HTTP frameworks |
| ethers.js / viem | Blockchain interaction |
| Go | wallet-tracker service |
| PostgreSQL | Persistent storage |
| Redis | Caching, session management |

### telegram

| Technology | Purpose |
|------------|---------|
| Next.js | MiniApp frontend framework |
| React | UI component library |
| Fastify | Bot gateway server |
| Thirdweb SDK | Wallet connection and management |
| TailwindCSS | Styling |
| Telegram WebApp SDK | MiniApp integration |

## Data Flow Summary

1. **Inbound:** User message arrives via Telegram Bot API or MiniApp HTTP request.
2. **Routing:** The agent layer classifies intent using semantic embeddings and routes to the appropriate handler.
3. **Parameter Collection:** If parameters are missing, the agent enters a conversational loop to collect them.
4. **Transaction Preparation:** The relevant backend microservice constructs the transaction calldata.
5. **Signing:** The MiniApp presents the transaction for user approval and signing via Thirdweb wallet.
6. **Execution:** The signed transaction is submitted to the target chain (or to PanoramaExecutor for multi-step plans).
7. **Confirmation:** The system monitors the transaction and reports status back to the user.
