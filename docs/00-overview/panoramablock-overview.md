# PanoramaBlock Overview

## What is PanoramaBlock

PanoramaBlock is an AI-native DeFi execution platform that enables users to interact with decentralized finance protocols through natural language. Instead of navigating complex protocol interfaces, users describe their financial goals in plain English -- via Telegram chat or a web application -- and PanoramaBlock's AI agents interpret, plan, and execute the corresponding on-chain operations.

The platform abstracts away the complexity of multi-chain DeFi by combining conversational AI, microservice-based backend infrastructure, and smart contract execution into a unified system.

## Repository Structure

PanoramaBlock is organized across three repositories, each responsible for a distinct layer of the system.

### 1. zico_agents (AI Agent Layer)

- **Language:** Python
- **Framework:** LangGraph (StateGraph)
- **Purpose:** Houses the AI agent system that processes user intents. Implements semantic routing with embedding-based intent classification across 9 categories, using a confidence threshold of 0.78 to determine routing accuracy. The agent layer is responsible for understanding what the user wants and translating that into structured execution plans.

### 2. panorama-block-backend (Backend Services)

- **Language:** Node.js (TypeScript)
- **Purpose:** Contains 9 microservices that handle authentication, protocol integrations, transaction preparation, portfolio tracking, and database operations. Each microservice is independently deployable and communicates through well-defined APIs.

### 3. telegram (Frontend Layer)

- **Framework:** Next.js (MiniApp) + Fastify (Bot Gateway)
- **Purpose:** Provides the user-facing interface through both a Telegram MiniApp and a bot gateway. Handles wallet connections via Thirdweb, Telegram WebApp authentication, and the full transaction lifecycle from creation to confirmation.

## Current Capabilities

### Staking

Users can stake ETH through Lido to receive stETH, with real-time APY information and support for both standard unstaking (7-day queue) and instant unstaking (with fee). Available on Ethereum mainnet.

### Lending

Integration with Benqi on Avalanche allows users to supply tokens as collateral, receive qTokens representing their position, borrow against collateral with health factor monitoring, and manage positions through withdrawal and repayment flows.

### Token Swaps

Liquid swap functionality supports token exchanges across multiple chains. The swap microservice handles route optimization, slippage calculation, and transaction preparation for supported token pairs.

### Dollar-Cost Averaging (DCA)

Automated recurring purchases using ERC-4337 Account Abstraction. Users define a token pair, amount, and frequency, and the system executes trades on schedule without requiring repeated manual approvals.

### Conversational AI Agents

The LangGraph-based agent system supports 9 intent categories through semantic routing. Users interact in natural language, and the system classifies intent, collects required parameters, and routes to the appropriate execution path. The agents maintain conversational state to handle multi-turn interactions for complex operations.

### Portfolio Tracking

Cross-chain portfolio visibility across Ethereum, Base, Avalanche, Polygon, Arbitrum, Optimism, BSC, and World Chain. The wallet tracker service (implemented in Go) aggregates balances and positions across supported networks.

## Supported Chains

| Chain | Status |
|-------|--------|
| Ethereum | Active |
| Base | Active |
| Avalanche | Active |
| Polygon | Active |
| Arbitrum | Active |
| Optimism | Active |
| BSC | Active |
| World Chain | Active |

## The Transition to On-Chain Execution

### Current Limitation

Today, PanoramaBlock's execution relies on off-chain transaction preparation. The backend microservices construct transactions that are then signed by the user's wallet and submitted individually. This approach works for single-step operations but creates significant friction for multi-protocol strategies that require sequential, dependent transactions.

### Execution Layer Introduction

PanoramaBlock is introducing an on-chain execution layer built on Base, consisting of two core contracts:

- **PanoramaExecutor.sol** -- A general-purpose execution contract that can receive a sequence of operations and execute them atomically. This enables multi-step DeFi strategies (swap, then lend, then stake) to be bundled into a single transaction, reducing gas costs and eliminating partial-execution risk.

- **AerodromeAdapter.sol** -- A protocol-specific adapter for Aerodrome (Base's primary DEX), integrating with Router2 (`0xcF77a3Ba9A5CA399B7c97c74d54e5b1Beb874E43`), Factory (`0x420D...`), and Voter (`0x1661...`) contracts. This adapter handles swap routing, liquidity provision, and gauge interactions.

### Why This Matters

The execution layer transforms PanoramaBlock from a transaction preparation service into a true execution infrastructure. Users will be able to express complex financial goals ("generate yield on $5000 with moderate risk") and have the system plan and execute the entire strategy atomically on-chain. This is essential for enabling the Strategy Agent -- the next evolution of the AI layer -- which will compose multi-protocol plans that require atomic execution guarantees.

### Base Token Registry

The execution layer launches with support for the following Base tokens:

| Token | Purpose |
|-------|---------|
| USDC | Stablecoin base pair |
| ETH | Native gas and collateral |
| CBBTC | Bitcoin exposure on Base |
| AERO | Aerodrome governance and incentives |
