# PanoramaBlock -- System Understanding

## Document Purpose

This document captures the current understanding of PanoramaBlock as a system, based on ongoing product discussions, architectural decisions, and implementation work. It serves as a high-level internal reference describing what PanoramaBlock is, how the system is structured, how the components interact, how the architecture is evolving, and what the long-term vision is.

## 1. What PanoramaBlock Is

PanoramaBlock is an AI-native DeFi infrastructure platform. Users express intent. PanoramaBlock translates that intent into DeFi strategies and on-chain execution.

Example user intention:

"I have $2,500 and I want to buy a MacBook without losing all my capital."

PanoramaBlock interprets the intention and may produce strategies such as structured yield, staking positions, lending-backed liquidity, DCA accumulation, or liquidity provisioning.

## 2. Core Product Idea

Traditional DeFi: User -> Protocol -> Transaction

PanoramaBlock: User -> Intent -> AI Agent -> Strategy -> Execution

PanoramaBlock sits above the DeFi stack, orchestrating activity.

## 3. Core System Components

### 3.1 Zico Agents (Intelligence Layer)

The agent layer interprets user intent and routes to appropriate services. Built on LangGraph StateGraph with embedding-based semantic routing across 9 intent categories. Agents do not directly interact with smart contracts. They coordinate backend services.

Key capabilities:
- Semantic intent classification (cosine similarity, threshold 0.78)
- Pre-extraction of parameters via regex before LLM invocation
- Context windowing (8 recent messages, older messages summarized)
- Dual response modes (fast vs reasoning)
- Stateful DeFi operations via storage repositories

### 3.2 PanoramaBlock Backend (Service Layer)

Multiple microservices responsible for interacting with protocols and blockchains. Services prepare transactions, fetch on-chain data, normalize protocol interfaces, and track user positions.

In the current system, most operations are transaction planners rather than direct on-chain executors.

### 3.3 Telegram Repository (Interface Layer)

Contains the Telegram MiniApp (Next.js 15), web interface, and chat gateway (Fastify + grammy). Users interact through chat agents, MiniApp interfaces, and web dashboards.

The MiniApp handles wallet connection (Thirdweb for EVM, TonConnect for TON), transaction signing, and operation tracking.

## 4. Current Limitation

Most PanoramaBlock activity happens off-chain. Backend services prepare transactions but do not execute them through Panorama-controlled smart contracts.

This causes:
- Limited measurable ecosystem value for grant programs
- Weak hackathon/grant narrative (appears as tooling rather than infrastructure)
- No visible on-chain transaction flow attributable to PanoramaBlock

## 5. Introduction of the Execution Layer

PanoramaBlock is introducing smart contracts deployed on EVM chains. The first target chain is Base. The architecture becomes:

```
User -> Telegram/Web -> AI Agent -> Backend Services -> Execution Smart Contracts -> DeFi Protocols
```

## 6. Execution Layer Architecture

The execution layer uses a thin executor + protocol adapter pattern.

PanoramaExecutor.sol is the core entry point. It maintains a registry mapping protocol identifiers to adapter contract addresses. When an operation is requested, the executor delegates to the appropriate adapter.

AerodromeAdapter.sol is the first adapter implementation, wrapping Aerodrome Finance on Base (Router2, Factory, Voter, Gauges).

This pattern is reusable: deploy the same executor on any EVM chain, write a protocol-specific adapter, register it.

## 7. First Protocol Target: Aerodrome

Aerodrome is the primary DEX on Base. Initial operations:
- Token swaps
- Liquidity provision
- Liquidity removal
- LP staking in gauges

## 8. Strategy Agent Layer

The Strategy Agent moves PanoramaBlock beyond simple actions. Instead of User -> Action, it becomes User -> Strategy -> Execution Plan.

Strategies are defined through structured documents known as strategy blocks. A strategy block describes the goal, required assets, risk profile, protocol interactions, and execution steps.

## 9. Base Strategies

Initial strategies:
- Stable yield (lend stablecoins)
- ETH long-term staking (Lido)
- AVAX yield (Benqi supply)
- DCA accumulation (recurring buys)
- Liquidity provision (LP + gauge staking)

## 10. Onboarding and User Education

Users often struggle with understanding the MiniApp, wallet connections, and the difference between chat actions and on-chain execution. The system requires interactive onboarding, guided flows, and clear explanations across website, Telegram bot, and MiniApp entry flows.

## 11. Multi-Chain Strategy

The execution layer is chain-agnostic. The same architecture deploys to Base, Avalanche, Arbitrum, Optimism, and other EVM networks.

## 12. Strategic Positioning

Three pillars:
1. AI Agents (intelligence)
2. DeFi Execution Infrastructure (on-chain)
3. Multi-Protocol Strategy Engine (orchestration)

Together: AI-native DeFi execution infrastructure.

## 13. Current Development Tracks

1. **Execution Layer** - Smart contract infrastructure for on-chain execution
2. **Strategy Agent** - Agent logic for strategy interpretation and planning
3. **Onboarding** - Improved user activation and guidance

## 14. Current Product State

Implemented: staking (Lido), lending (Benqi), swap routing, AI chat agents, Telegram MiniApp, portfolio analysis, DCA automation, cross-chain bridging.

Next phase: on-chain execution, strategy automation, multi-chain expansion.
