# Implementation Roadmap

## Phase 1: MVP (Weeks 1-2)

### Execution Layer
- Deploy PanoramaExecutor + AerodromeAdapter on Base mainnet
- Backend execution-service with prepare-swap, quote, pools endpoints
- execution_agent with swap intent collection
- Frontend execution page in MiniApp
- E2E: chat -> agent -> backend -> sign -> on-chain swap

### Strategy Agent
- Define strategy block schema
- Document 5 base strategies

### Onboarding
- Define entry points and content map
- Write core content blocks

## Phase 2: Full Execution (Weeks 3-4)

### Execution Layer
- Add liquidity operations (addLiquidity, removeLiquidity)
- Add LP staking/unstaking via gauges
- Position tracking endpoint
- Multiple pool support (volatile + stable)

### Strategy Agent
- Implement strategy agent v1
- Integrate with execution-service for multi-step strategies
- Support 3 base strategies (stable yield, staking, liquidity)

### Onboarding
- Implement site onboarding flow
- Implement Telegram onboarding flow
- First-action guided experience

## Phase 3: Multi-Chain (Weeks 5-8)

### Execution Layer
- Deploy to Avalanche (Trader Joe adapter)
- Deploy to Arbitrum (Camelot adapter)
- Multi-chain config in backend

### Strategy Agent
- Cross-chain strategies
- Strategy comparison and recommendation
- Portfolio-aware strategy suggestions

### Onboarding
- Chain-specific onboarding paths
- Multi-wallet support guidance

## Phase 4: Advanced (Weeks 9+)

### Execution Layer
- Batch multi-step execution (single tx for full strategy)
- Fee collection mechanism
- Event indexing / subgraph for analytics

### Strategy Agent
- Auto-rebalancing
- Risk monitoring and alerts
- Advanced strategies (hedging, leveraged yield)

### Onboarding
- Personalized onboarding based on user profile
- A/B testing for conversion optimization
