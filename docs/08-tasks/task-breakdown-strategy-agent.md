# Task Breakdown: Strategy Agent

## Phase 1: Strategy Definition Layer

### Schema Design
- [ ] Define strategy block JSON schema (all fields)
- [ ] Review Gustavo's strategy block document
- [ ] Normalize field names for backend consumption
- [ ] Define required vs optional input fields
- [ ] Define risk labels: low, moderate, high
- [ ] Define user_intent_type enum: yield, staking, accumulation, liquidity, hedging

### Validation
- [ ] Create JSON Schema validation for strategy blocks
- [ ] Ensure all strategy blocks pass validation
- [ ] Document schema with examples

## Phase 2: Base Strategies (5 Strategies)

### Strategy 1: Stable Yield
- [ ] Write strategy block JSON
- [ ] Define execution steps: supply USDC to Benqi/Moonwell
- [ ] Set risk parameters: low risk, smart contract risk, variable APY
- [ ] Write educational copy
- [ ] Map to backend services (lending-service)

### Strategy 2: ETH Long-Term Staking
- [ ] Write strategy block JSON
- [ ] Define execution steps: stake ETH via Lido
- [ ] Set risk parameters: low risk, lock period, slashing risk
- [ ] Write educational copy
- [ ] Map to backend services (lido-service)

### Strategy 3: AVAX Yield
- [ ] Write strategy block JSON
- [ ] Define execution steps: supply AVAX to Benqi
- [ ] Set risk parameters: low-moderate risk, AVAX price exposure
- [ ] Write educational copy
- [ ] Map to backend services (lending-service)

### Strategy 4: DCA Accumulation
- [ ] Write strategy block JSON
- [ ] Define execution steps: recurring swaps on schedule
- [ ] Set risk parameters: variable risk (depends on target asset)
- [ ] Write educational copy
- [ ] Map to backend services (dca-service)

### Strategy 5: Liquidity Provision
- [ ] Write strategy block JSON
- [ ] Define execution steps: swap -> addLiquidity -> stake in gauge
- [ ] Set risk parameters: moderate risk, impermanent loss, smart contract risk
- [ ] Write educational copy
- [ ] Map to backend services (execution-service)

## Phase 3: Agent Logic

### Semantic Router Extension
- [ ] Add STRATEGY intent category
- [ ] Define utterances: "I want yield", "help me invest", "what should I do with my ETH"
- [ ] Set confidence thresholds (HIGH=0.78, LOW=0.50)
- [ ] Test classification accuracy

### Strategy Agent Core
- [ ] Create strategy_agent directory (agent.py, tools.py, prompt.py, config.py, storage.py)
- [ ] Implement system prompt with strategy knowledge
- [ ] Implement tools:
  - [ ] `get_user_profile` - Risk preference, chain preference, capital
  - [ ] `match_strategies` - Filter strategies by profile
  - [ ] `propose_strategy` - Generate strategy proposal with explanation
  - [ ] `update_strategy_intent` - Store selected strategy in session

### Missing Information Extraction
- [ ] Detect missing required inputs (amount, chain, risk preference)
- [ ] Generate natural follow-up questions
- [ ] Handle ambiguous responses
- [ ] Support "I don't know" -> use defaults

### Multi-Strategy Proposal
- [ ] Generate 2-3 options ranked by fit
- [ ] Include risk/reward comparison
- [ ] Include educational explanation for each
- [ ] Handle user selection

### Graph Integration
- [ ] Add strategy_agent node to nodes.py
- [ ] Register in factory.py
- [ ] Add strategy fields to state.py
- [ ] Wire routing: STRATEGY intent -> strategy_agent node

## Phase 4: Backend Integration

### Output Contract
- [ ] Define JSON output schema (strategy_id, steps[], params)
- [ ] Map strategy actions to backend service endpoints
- [ ] Implement step sequencing (swap before addLiquidity before stake)

### Execution Bridge
- [ ] Convert strategy steps to PreparedTx[] format
- [ ] Handle multi-service orchestration (call swap-service, then execution-service)
- [ ] Support partial execution (step 1 succeeded, step 2 failed)

### Error Handling
- [ ] Define fallback behavior for unsupported paths
- [ ] Handle insufficient balance mid-strategy
- [ ] Handle protocol-specific errors (pool paused, slippage exceeded)
- [ ] Generate user-friendly error messages

### Testing
- [ ] Test strategy matching with various user profiles
- [ ] Test multi-step execution sequencing
- [ ] Test partial failure recovery
- [ ] E2E: "I have $5000 and want safe yield" -> strategy proposal -> execution
