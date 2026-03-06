# Agent Architecture

## Overview

The agent layer is built on LangGraph StateGraph, providing a directed graph of processing nodes that handle user messages from receipt through intent classification, agent execution, and response formatting.

## StateGraph Flow

```
User Message
  |
  v
entry_node (zero LLM calls)
  |
  v
semantic_router_node (embedding classification)
  |
  +-- confidence >= 0.78 --> agent_node (direct routing)
  |
  +-- 0.50 <= confidence < 0.78 --> llm_router_node --> agent_node
  |
  +-- confidence < 0.50 --> default_agent
  |
  v
formatter_node (output formatting)
  |
  v
Response
```

## Node Descriptions

### entry_node
Zero LLM calls. Performs:
- Conversation windowing (preserves last 8 messages, summarizes older ones)
- DeFi state lookup (swap_state, lending_state, staking_state, dca_state, execution_state)
- LangChain message building
- Response mode injection (fast vs reasoning)

### semantic_router_node
Embedding-based intent classification:
1. Generates embedding for the user message using Google Gemini Embedding 001
2. Computes cosine similarity against pre-computed exemplar embeddings for each intent category
3. Routes based on confidence:
   - HIGH_CONFIDENCE (0.78): route directly to matched agent
   - LOW_CONFIDENCE (0.50): send to llm_router for confirmation
   - Below 0.50: route to default_agent (GENERAL)

### llm_router_node
Fallback routing when semantic confidence is insufficient:
- Uses LLM to confirm the intended category
- Provides the top semantic matches as context
- Routes to confirmed agent

### Agent Nodes (10 total)
Each agent uses LangChain create_react_agent with specialized tools:

| Agent | Intent Category | Key Tools |
|-------|----------------|-----------|
| swap_agent | SWAP | update_swap_intent, list_tokens, list_networks |
| lending_agent | LENDING | update_lending_intent |
| staking_agent | STAKING | update_staking_intent |
| dca_agent | DCA | update_dca_intent |
| execution_agent | EXECUTION (NEW) | update_execution_intent |
| crypto_data_agent | MARKET_DATA | get_price, get_market_data |
| portfolio_advisor | PORTFOLIO | analyze_portfolio |
| search_agent | SEARCH | web_search |
| database_agent | - | query_database |
| default_agent | GENERAL | - |

### formatter_node
Mode-aware output formatting:
- **Fast mode**: Light structural guidance (title, content, conclusion)
- **Reasoning mode**: Deep analysis with step-by-step reasoning, risk warnings, source citation

## State Management

AgentState (TypedDict):
```python
# Input
messages: List[BaseMessage]
user_id: str
conversation_id: str
wallet_address: Optional[str]
metadata: Dict[str, Any]

# Routing
route_intent: Optional[str]
route_confidence: Optional[float]
route_agent: Optional[str]
needs_llm_confirmation: bool

# DeFi State
swap_state: Optional[Dict]
lending_state: Optional[Dict]
staking_state: Optional[Dict]
dca_state: Optional[Dict]
execution_state: Optional[Dict]  # NEW

# Output
final_response: Optional[str]
response_agent: Optional[str]
response_metadata: Optional[Dict]
nodes_executed: List[str]
```

## Intent Collection Pattern

DeFi agents follow a consistent pattern (exemplified by swap_agent/tools.py):

1. Tool receives partial parameters from user message
2. Loads existing intent from storage repository (keyed by user_id + conversation_id)
3. Validates and merges new parameters
4. Checks if intent is complete (all required fields present)
5. If incomplete: returns next question with available choices
6. If complete: stores metadata with event name (e.g., "execution_intent_ready"), persists to storage

## Storage Repositories

Singleton pattern per agent type:
- SwapStateRepository
- LendingStateRepository
- StakingStateRepository
- DcaStateRepository
- ExecutionStateRepository (NEW)

Each stores intent state keyed by (user_id, conversation_id) and persists across conversation turns.

## Memory Management

Context windowing strategy:
- Preserves last 8 recent messages verbatim
- Older messages summarized using FAST tier LLM
- Fallback: drop older messages if summarizer unavailable
- Bounded context prevents token overflow

## LLM Configuration

| Tier | Model | Usage |
|------|-------|-------|
| Default (FAST) | gemini-2.5-flash | Standard agent responses |
| Reasoning | gemini-3-flash-preview | Deep analysis, strategy planning |
| Embedding | gemini-embedding-001 | Semantic routing |

## New Execution Agent Integration

Added as a new intent category in the semantic router with exemplars:
- "Swap ETH for USDC on Aerodrome"
- "Add liquidity to the ETH/USDC pool on Aerodrome"
- "Stake my LP tokens in Aerodrome gauge"

Wired into the graph via:
- New execution_agent_node in nodes.py
- Registered in factory.py
- execution_state added to AgentState
