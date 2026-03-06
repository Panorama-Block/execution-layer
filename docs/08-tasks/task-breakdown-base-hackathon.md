# Task Breakdown: Base Hackathon

## Deadline: March 9

## Day 1 (March 7) - Contracts + Backend

### Smart Contract Deployment
- [ ] Deploy PanoramaExecutor.sol to Base mainnet
- [ ] Deploy AerodromeAdapter.sol to Base mainnet
- [ ] Call `registerAdapter("aerodrome", aerodromeAdapterAddress)` on executor
- [ ] Verify both contracts on BaseScan
- [ ] Test swap via cast: `cast send $EXECUTOR "executeSwap(...)" --value 0.001ether`

### Backend Skeleton
- [ ] Initialize execution-service (Express, TypeScript, port 3010)
- [ ] Add chain config (Base RPC URL, contract addresses)
- [ ] Add Aerodrome ABI fragments for encoding

### Backend Endpoints
- [ ] POST /execution/quote
  - Input: `{ tokenIn, tokenOut, amountIn }`
  - Output: `{ amountOut, priceImpact, route }`
  - Calls Aerodrome Router.getAmountsOut()
- [ ] POST /execution/prepare-swap
  - Input: `{ tokenIn, tokenOut, amountIn, amountOutMin, userAddress, deadline }`
  - Output: `{ to, data, value }` (ready for signing)
  - Encodes PanoramaExecutor.executeSwap() calldata

## Day 2 (March 8) - Agent + Frontend + Integration

### Agent: Execution Intent
- [ ] Add EXECUTION intent to semantic router utterances
- [ ] Create execution_agent directory structure
- [ ] Implement update_execution_intent tool (collects tokenIn, tokenOut, amount)
- [ ] Wire execution_agent into graph (nodes.py, factory.py)
- [ ] Test: "swap 0.01 ETH to USDC" -> agent returns structured intent

### Frontend: Execution Page
- [ ] Create execution feature module (api.ts, types.ts)
- [ ] Build basic execution page with:
  - Token pair display (from agent intent)
  - Quote display (amount out, price impact)
  - Confirm button
- [ ] Wire transaction signing (safeExecuteTransactionV2)
- [ ] Add transaction status display

### Gateway: Action Button
- [ ] Detect `execution_intent_ready` in agent response metadata
- [ ] Build inline button: "Execute Swap" -> deep link to MiniApp
- [ ] Pass execution params (tokenIn, tokenOut, amount) via deep link

### E2E Test
- [ ] Send "swap 0.001 ETH to USDC" to Telegram bot
- [ ] Verify agent responds with swap details + action button
- [ ] Click button -> MiniApp opens execution page
- [ ] Sign transaction -> verify on BaseScan

## Day 3 (March 9) - Polish + Demo

### Bug Fixes
- [ ] Fix any issues from Day 2 E2E testing
- [ ] Handle edge cases (insufficient balance, failed quotes)
- [ ] Improve error messages

### Additional Endpoint
- [ ] GET /execution/pools - List available Aerodrome pools
  - Output: `{ pools: [{ token0, token1, stable, address, tvl }] }`

### Polish
- [ ] Improve execution page UI (loading states, animations)
- [ ] Add pool info display
- [ ] Ensure mobile-friendly layout in Telegram WebApp

### Demo Preparation
- [ ] Write demo script (narrative flow)
- [ ] Prepare wallet with test funds (0.01 ETH on Base)
- [ ] Do 3 dry runs of full flow
- [ ] Record backup demo video
- [ ] Submit to hackathon

## Demo Script

1. Open Telegram, show PanoramaBlock bot
2. Type: "I want to swap some ETH for USDC on Base"
3. Agent asks for amount, user says "0.005 ETH"
4. Agent confirms details, shows "Execute Swap" button
5. Click button -> MiniApp opens with pre-filled swap
6. Show quote (amount out, price impact, route)
7. Click "Confirm Swap" -> wallet signs transaction
8. Show transaction confirming on BaseScan
9. Show tx went through PanoramaExecutor contract
10. Highlight: "One chat message -> on-chain execution"

## Success Criteria

- [ ] Contracts deployed and verified on BaseScan
- [ ] Can swap ETH -> USDC via chat command
- [ ] Transaction visible on BaseScan through PanoramaExecutor
- [ ] MiniApp shows confirmation with amounts
- [ ] Agent responds naturally to swap requests
- [ ] Full flow works in under 30 seconds
