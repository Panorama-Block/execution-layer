# Task Breakdown: Execution Layer

## Phase 1: Smart Contracts

### Core Contracts
- [x] PanoramaExecutor.sol - Core entry point with adapter registry
- [x] IProtocolAdapter.sol - Generic adapter interface
- [x] SafeTransferLib.sol - Safe ERC20 transfer helpers

### Aerodrome Integration
- [x] IAerodromeRouter.sol - Router2 interface (Route struct, swap, liquidity)
- [x] IAerodromeGauge.sol - Gauge + Voter interfaces
- [x] IERC20.sol - Minimal ERC20 interface
- [x] AerodromeAdapter.sol - Full Aerodrome wrapper (swap, LP, stake)

### Testing
- [x] MockERC20.sol - Mock token with mint
- [x] MockRouter.sol - Mock Aerodrome router
- [x] PanoramaExecutor.t.sol - Unit tests (admin, swap, emergency)
- [x] AerodromeAdapter.t.sol - Fork tests against Base mainnet

### Deployment
- [x] Deploy.s.sol - Base mainnet deployment script
- [x] DeployTestnet.s.sol - Base Sepolia deployment script
- [ ] Deploy PanoramaExecutor to Base mainnet
- [ ] Deploy AerodromeAdapter to Base mainnet
- [ ] Register adapter in executor
- [ ] Verify contracts on BaseScan

## Phase 2: Backend (execution-service)

### Service Setup
- [ ] Express server on port 3010
- [ ] Chain config (Base RPC, contract addresses)
- [ ] Protocol config (Aerodrome addresses, ABIs)
- [ ] Docker setup

### API Endpoints
- [ ] POST /execution/quote - Query Aerodrome getAmountsOut
- [ ] POST /execution/prepare-swap - Encode swap calldata for signing
- [ ] GET /execution/pools - List available Aerodrome pools
- [ ] POST /execution/prepare-liquidity (Phase 2)
- [ ] POST /execution/prepare-stake (Phase 2)

### Providers
- [ ] AerodromeProvider - Read pool data, get quotes, encode routes
- [ ] ChainProvider - RPC connection, contract instances

## Phase 3: Agent Integration

### Semantic Router
- [ ] Add EXECUTION intent category
- [ ] Define utterances for execution intents
- [ ] Set confidence thresholds

### Execution Agent
- [ ] Create agent.py with execution tools
- [ ] Create tools.py with intent collection (update_execution_intent)
- [ ] Create prompt.py with system prompt
- [ ] Create config.py with agent configuration
- [ ] Create storage.py with ExecutionStateRepository

### Graph Integration
- [ ] Add execution_agent node to nodes.py
- [ ] Register in factory.py
- [ ] Add execution fields to state.py

## Phase 4: Frontend Integration

### Execution Feature Module
- [ ] api.ts - Backend API client (quote, prepare-swap, pools)
- [ ] types.ts - TypeScript types for execution data

### Execution Page
- [ ] Token selection (tokenIn, tokenOut)
- [ ] Amount input with quote display
- [ ] Slippage settings
- [ ] Transaction signing via safeExecuteTransactionV2
- [ ] Transaction status tracking

### Gateway Integration
- [ ] Detect execution_intent_ready from agent response
- [ ] Build action button with deep link to MiniApp execution page
- [ ] Pass execution params via URL or session

## Phase 5: E2E Integration
- [ ] Test: chat "swap 0.001 ETH to USDC" -> agent collects intent
- [ ] Test: agent returns execution_intent_ready -> gateway builds button
- [ ] Test: MiniApp loads execution page with pre-filled params
- [ ] Test: User signs -> tx submitted -> confirmed on BaseScan
- [ ] Test: Transaction visible through PanoramaExecutor on-chain
