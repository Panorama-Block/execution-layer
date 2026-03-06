# Hackathon MVP Scope

## Deadline: March 9

## Must Build

| Component | Scope | Effort |
|-----------|-------|--------|
| Contracts | PanoramaExecutor + AerodromeAdapter (swap only) | ~4h |
| Deploy | Base mainnet (real Aerodrome pools) | ~1h |
| Backend | execution-service: /prepare-swap, /quote, /pools | ~6h |
| Agent | execution_agent with swap intent collection | ~3h |
| Frontend | Basic execution page, reuse existing signing flow | ~3h |
| Integration | E2E: chat -> agent -> backend -> sign -> on-chain | ~3h |

## Skip for MVP

- addLiquidity / removeLiquidity
- LP staking / unstaking
- Batch multi-step operations
- Position tracking endpoint
- Multiple chains (Avalanche, Arbitrum)
- Fee collection mechanism
- Event indexing / subgraph
- Strategy agent
- Onboarding improvements

## 3-Day Timeline

### Day 1 (March 7)
- [ ] Deploy PanoramaExecutor.sol to Base mainnet
- [ ] Deploy AerodromeAdapter.sol to Base mainnet
- [ ] Register adapter in executor
- [ ] Verify on BaseScan
- [ ] Backend: execution-service skeleton (Express, port 3010)
- [ ] Backend: POST /execution/quote (query Aerodrome getAmountsOut)
- [ ] Backend: POST /execution/prepare-swap (encode calldata)

### Day 2 (March 8)
- [ ] Agent: Add EXECUTION intent category to semantic router
- [ ] Agent: Create execution_agent (agent.py, tools.py, prompt.py, config.py, storage.py)
- [ ] Agent: Wire into graph (nodes.py, factory.py, state.py)
- [ ] Frontend: execution feature module (api.ts, types.ts)
- [ ] Frontend: basic execution page
- [ ] Gateway: detect execution_intent_ready, build action button
- [ ] Test E2E flow with small amount (0.001 ETH -> USDC)

### Day 3 (March 9)
- [ ] Fix bugs from E2E testing
- [ ] Add POST /execution/pools endpoint
- [ ] Polish execution page UI
- [ ] Prepare demo script
- [ ] Record demo video (backup)
- [ ] Submit to hackathon

## Demo-Ready Checklist

- [ ] Contracts deployed and verified on BaseScan
- [ ] Can swap ETH->USDC via chat command
- [ ] Transaction visible on BaseScan through PanoramaExecutor
- [ ] MiniApp shows confirmation with amounts
- [ ] Agent responds naturally to swap requests
