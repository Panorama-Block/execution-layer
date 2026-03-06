# Strategy Agent Sequence

## Diagram

See [diagrams/defi-strategy-sequence.mmd](../diagrams/defi-strategy-sequence.mmd) for the full Mermaid source.

```mermaid
sequenceDiagram
    actor User
    participant Agent as Strategy Agent
    participant Backend as Backend Services
    participant Executor as PanoramaExecutor
    participant Aero as Aerodrome
    participant Moon as Moonwell

    User->>Agent: "Earn yield on $5000, moderate risk"
    Agent->>Agent: Analyze risk, capital, protocols
    Agent-->>User: Strategy proposal (4 steps)
    User->>Agent: "Approve"
    Backend->>Executor: Step 1: swap USDC->WETH
    Executor->>Aero: swapExactTokensForTokens
    Backend->>Moon: Step 2: supply USDC
    Backend->>Executor: Step 3: addLiquidity WETH/USDC
    Executor->>Aero: addLiquidity
    Backend->>Executor: Step 4: stake LP
    Executor->>Aero: gauge.deposit
    Agent-->>User: Strategy executed!
```

## Step-by-Step

1. User expresses a financial goal in natural language.
2. Strategy Agent analyzes: risk profile, capital, target chain, available protocols.
3. Agent constructs multi-step strategy proposal with expected outcomes.
4. User reviews and approves.
5. Each step executes sequentially as separate transactions.
6. User signs each transaction via Thirdweb.
7. Agent tracks progress and reports completion.
8. Portfolio updated with new positions.
