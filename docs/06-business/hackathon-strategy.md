# Hackathon Strategy

## Target: Base Hackathon

- Submission deadline: March 9
- Results: March 22
- Potential prize pool: $50k

## Demo Narrative

"PanoramaBlock brings AI-native DeFi execution to Base. Users chat with our AI agent, which understands their DeFi intent and triggers on-chain execution through our smart contracts on Base."

## Demo Flow (3 minutes)

1. **Show the problem** (30s): "DeFi is fragmented. Users must navigate multiple protocols manually."

2. **Show the solution** (30s): "PanoramaBlock: tell an AI what you want, it executes on-chain."

3. **Live demo** (90s):
   - Open Telegram
   - Type: "Swap 0.01 ETH to USDC on Aerodrome"
   - Agent collects intent, shows [Execute] button
   - Open MiniApp, sign transaction
   - Show BaseScan: real on-chain execution through PanoramaExecutor -> AerodromeAdapter -> Aerodrome Router2

4. **Architecture** (30s): "AI agents -> backend service -> PanoramaExecutor.sol -> protocol adapters. Reusable across any EVM chain."

5. **Traction** (30s): "10,000 users on Avalanche. Now bringing execution infrastructure to Base."

## What Judges Want to See

- Real on-chain activity (not just UI mockups)
- Protocol integration (Aerodrome is a Base ecosystem project)
- Technical depth (smart contracts, not just API wrappers)
- User value (AI makes DeFi accessible)
- Scalability (multi-chain, multi-protocol architecture)

## MVP for Submission

Minimum viable for hackathon:
- PanoramaExecutor + AerodromeAdapter deployed on Base mainnet
- Execution-service with prepare-swap endpoint
- execution_agent with swap intent collection
- MiniApp execution page (can be minimal)
- One successful E2E demo: chat -> agent -> sign -> on-chain swap via Aerodrome
