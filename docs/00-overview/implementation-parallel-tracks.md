# Parallel Implementation Tracks

PanoramaBlock is evolving through three parallel implementation tracks. Each track addresses a distinct layer of the product and must progress together for the platform to deliver its full value.

## Track 1: Execution Layer

**Focus:** Build on-chain execution infrastructure.

**Why it matters:** Without execution contracts, PanoramaBlock generates no measurable on-chain activity. Blockchain ecosystems that fund PanoramaBlock through grants want real transaction volume and protocol integrations.

**Main outputs:**
- PanoramaExecutor.sol smart contract
- Protocol adapters (AerodromeAdapter first)
- Backend execution-service (:3010)
- Agent integration (execution_agent)
- Frontend execution flow in MiniApp

**Current status:** In development. Contracts designed. First target: Base + Aerodrome.

**Dependencies:**
- Requires backend infrastructure (existing)
- Requires agent framework (existing)
- Requires frontend signing flow (existing, reusable)

## Track 2: Strategy Agent

**Focus:** Transform user intent into structured DeFi strategies.

**Why it matters:** Without strategy intelligence, PanoramaBlock remains action-based rather than goal-based. Users must choose protocols and actions manually. The Strategy Agent bridges the gap between "I want yield" and "swap -> supply -> LP -> stake".

**Main outputs:**
- Strategy block document specification
- Base strategies catalog (5 initial strategies)
- Strategy agent logic (intent -> proposal -> execution plan)
- Backend-compatible action plans

**Current status:** In design. Depends on strategy block document from product team.

**Dependencies:**
- Requires strategy block document definition (Gustavo)
- Requires execution layer for on-chain actions
- Requires existing backend services for protocol interactions

## Track 3: Onboarding

**Focus:** Guide users through PanoramaBlock across site and Telegram.

**Why it matters:** Without clear onboarding, users do not understand how to use the product. The platform combines chat agents, a MiniApp, wallet connections, and multiple DeFi operations. This complexity requires guided activation.

**Main outputs:**
- Interactive onboarding flows (site + Telegram)
- Clearer activation paths
- Content explaining features, fees, execution
- Reduced product confusion

**Current status:** In design. Entry points identified. Content mapping in progress.

**Dependencies:**
- Requires frontend (existing)
- Requires auth flow (existing)
- Benefits from execution layer (more actions to guide toward)

## Why These Tracks Must Evolve Together

Without execution: the product stays mostly off-chain. There is no measurable ecosystem value. Grant narrative is weak.

Without strategy: the product remains action-based. Users must manually choose protocols. The AI layer adds limited value beyond simple routing.

Without onboarding: users do not understand what PanoramaBlock does or how to start. Activation rates stay low. The 10,000 waiting Avalanche users churn before taking first action.

## Track Interdependencies

```
Execution Layer <-------> Strategy Agent
     |                        |
     |   Both feed into       |
     |   onboarding content   |
     v                        v
         Onboarding Flow
```

- Strategy Agent needs Execution Layer to execute multi-step strategies on-chain
- Onboarding needs both tracks to have meaningful first actions to guide users toward
- Execution Layer benefits from Strategy Agent to generate complex transaction flows
