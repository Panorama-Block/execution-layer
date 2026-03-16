# PanoramaBlock Execution Layer

On-chain execution infrastructure for DeFi operations. Prepares unsigned transaction bundles that the backend delivers to the frontend for signing — the backend never holds private keys.

## Chains

| Chain | Status | Contracts |
|---|---|---|
| **Base** | Deployed (hackathon) | PanoramaExecutor, AerodromeAdapter, DCAVault |
| **Avalanche C-Chain** | Deploy pending | PanoramaSwap, PanoramaLend |

---

## Table of Contents

- [Architecture](#architecture)
- [Avalanche Layer](#avalanche-layer)
  - [Contracts](#contracts)
  - [Backend Routes](#backend-routes)
  - [Deploy](#deploy)
  - [Environment Variables](#environment-variables)
- [Base Layer (Hackathon)](#base-layer-hackathon)
- [Project Structure](#project-structure)
- [Running Locally](#running-locally)
- [Tests](#tests)

---

## Architecture

```
┌──────────────────────────────────────────────┐
│               Backend (Express)               │
│                                               │
│  /avax/swap     /avax/lending                 │  ← Avalanche C-Chain
│  /swap  /staking  /dca                        │  ← Base
│                                               │
│  Builds unsigned TransactionBundles           │
│  (approve + contract call per action)         │
└────────────────────┬─────────────────────────┘
                     │ steps[]: { to, data, value }
                     │ signed by user wallet
┌────────────────────▼─────────────────────────┐
│            Avalanche C-Chain (43114)          │
│                                               │
│  ┌─────────────────┐  ┌────────────────────┐  │
│  │  PanoramaSwap   │  │   PanoramaLend     │  │
│  │                 │  │                    │  │
│  │ swapTokens…     │  │ supply / redeem    │  │
│  │ swapAVAX…       │  │ borrow / repay     │  │
│  │ swapTokensForAV │  │ supplyAVAX / redee │  │
│  └────────┬────────┘  └──────────┬─────────┘  │
│           │                      │             │
│  ┌────────▼────────┐  ┌──────────▼──────────┐  │
│  │  Trader Joe V1  │  │   Benqi Finance     │  │
│  │  Router         │  │   qTokens +         │  │
│  │  (0x60aE61…)    │  │   Comptroller       │  │
│  └─────────────────┘  └─────────────────────┘  │
└───────────────────────────────────────────────┘
```

**Flow:**
1. Backend receives request (e.g. "prepare swap 1 AVAX → USDC")
2. Backend checks on-chain state (allowances, quotes)
3. Backend returns a `TransactionBundle` — ordered steps ready to sign
4. User signs each step with their wallet and broadcasts
5. Transaction goes through PanoramaSwap or PanoramaLend → generates AVAX gas fees

---

## Avalanche Layer

### Contracts

Located at `contracts/avax/`.

#### PanoramaSwap (`contracts/avax/core/PanoramaSwap.sol`)

Swap router wrapper for **Trader Joe V1** on Avalanche C-Chain. Every swap goes through this contract, generating a transaction that burns AVAX.

| Function | Description |
|---|---|
| `swapTokensForTokens(amountIn, amountOutMin, path, deadline)` | ERC20 → ERC20 |
| `swapAVAXForTokens(amountOutMin, path, deadline) payable` | AVAX → ERC20 |
| `swapTokensForAVAX(amountIn, amountOutMin, path, deadline)` | ERC20 → AVAX |
| `getAmountsOut(amountIn, path)` | Quote — expected output amounts |

**Key addresses:**
```
Trader Joe V1 Router: 0x60aE616a2155Ee3d9A68541Ba4544862310933d4
WAVAX:                0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7
```

#### PanoramaLend (`contracts/avax/lending/PanoramaLend.sol`)

Lending wrapper for **Benqi Finance** on Avalanche C-Chain. Routes supply, redeem, borrow, and repay through this contract.

| Function | Description |
|---|---|
| `supply(qToken, amount)` | Supply ERC20 → receive qTokens |
| `redeem(qToken, qTokenAmount)` | Redeem qTokens → receive ERC20 |
| `borrow(qToken, amount)` | Borrow ERC20 against collateral |
| `repay(qToken, amount)` | Repay ERC20 borrow |
| `supplyAVAX() payable` | Supply native AVAX → receive qiAVAX |
| `redeemAVAX(qTokenAmount)` | Redeem qiAVAX → receive AVAX |
| `borrowAVAX(amount)` | Borrow native AVAX against collateral |
| `repayAVAX() payable` | Repay native AVAX borrow |

**Key addresses:**
```
Benqi Comptroller: 0x486Af39519B4Dc9a7fCcd318217352830E8AD9b4
qiAVAX:            0x5C0401e81Bc07Ca70fAD469b451682c0d747Ef1c
qiUSDC (USDC.e):   0xBEb5d47A3f720Ec0a390d04b4d41ED7d9688bC7F
qiUSDT:            0xc9e5999b8e75C3fEB117F6f73E664b9f3C8ca65C
qiETH:             0x334AD834Cd4481BB02d09615E7c11a00579A7909
```

#### Interfaces (`contracts/avax/interfaces/`)

| File | Description |
|---|---|
| `ITraderJoeRouter.sol` | Trader Joe V1 router interface |
| `IBenqiToken.sol` | `IBenqiToken`, `IBenqiAVAX`, `IComptroller` |

---

### Backend Routes

Located at `backend/src/modules/avax-swap/` and `backend/src/modules/avax-lending/`.

#### Swap (`/avax/swap`)

| Method | Endpoint | Body | Description |
|---|---|---|---|
| `GET` | `/avax/swap/pairs` | — | Supported swap pairs |
| `POST` | `/avax/swap/quote` | `tokenIn, tokenOut, amountIn, slippageBps?` | Price quote (no tx) |
| `POST` | `/avax/swap/prepare` | `userAddress, tokenIn, tokenOut, amountIn, slippageBps?, deadlineMinutes?` | Bundle: `[approve?] + swap` |

**Example — prepare swap:**
```bash
curl -X POST http://localhost:3010/avax/swap/prepare \
  -H "Content-Type: application/json" \
  -d '{
    "userAddress": "0xYourAddress",
    "tokenIn": "0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7",
    "tokenOut": "0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E",
    "amountIn": "1000000000000000000",
    "slippageBps": 50
  }'
```

Response:
```json
{
  "bundle": {
    "steps": [
      {
        "to": "0x<PanoramaSwap>",
        "data": "0x...",
        "value": "1000000000000000000",
        "chainId": 43114,
        "description": "Swap via PanoramaSwap (avax-to-token)"
      }
    ],
    "totalSteps": 1,
    "summary": "Swap avax-to-token via PanoramaSwap on Avalanche"
  },
  "metadata": {
    "tokenIn": "0xB31f66...",
    "tokenOut": "0xB97EF9...",
    "amountIn": "1000000000000000000",
    "amountOut": "9500000",
    "amountOutMin": "9025000",
    "path": ["0xB31f66...", "0xB97EF9..."],
    "swapType": "avax-to-token",
    "slippageBps": 50,
    "priceImpact": "-9999999.5000"
  }
}
```

#### Lending (`/avax/lending`)

| Method | Endpoint | Body | Description |
|---|---|---|---|
| `GET` | `/avax/lending/markets` | — | Benqi markets with live supply/borrow rates |
| `GET` | `/avax/lending/position/:userAddress` | — | User's active qToken balances |
| `POST` | `/avax/lending/prepare-supply` | `userAddress, qTokenAddress, amount` | Bundle: `[approve?] + supply/supplyAVAX` |
| `POST` | `/avax/lending/prepare-redeem` | `userAddress, qTokenAddress, qTokenAmount` | Bundle: `[approve qToken] + redeem/redeemAVAX` |
| `POST` | `/avax/lending/prepare-borrow` | `userAddress, qTokenAddress, amount` | Bundle: `borrow/borrowAVAX` |
| `POST` | `/avax/lending/prepare-repay` | `userAddress, qTokenAddress, amount` | Bundle: `[approve?] + repay/repayAVAX` |

**Example — supply AVAX:**
```bash
curl -X POST http://localhost:3010/avax/lending/prepare-supply \
  -H "Content-Type: application/json" \
  -d '{
    "userAddress": "0xYourAddress",
    "qTokenAddress": "0x5C0401e81Bc07Ca70fAD469b451682c0d747Ef1c",
    "amount": "5000000000000000000"
  }'
```

**Example — supply USDC.e:**
```bash
curl -X POST http://localhost:3010/avax/lending/prepare-supply \
  -H "Content-Type: application/json" \
  -d '{
    "userAddress": "0xYourAddress",
    "qTokenAddress": "0xBEb5d47A3f720Ec0a390d04b4d41ED7d9688bC7F",
    "amount": "100000000"
  }'
```

Response includes `[approve USDC.e, supply]` or just `[supplyAVAX]` for native AVAX.

---

### Deploy

```bash
# Set env vars
source .env  # must have PRIVATE_KEY, AVAX_RPC_URL, SNOWTRACE_API_KEY

# Deploy both contracts + verify on Snowtrace
forge script script/avax/DeployAvax.s.sol \
  --rpc-url $AVAX_RPC_URL \
  --broadcast \
  --verify \
  --verifier-url https://api.snowtrace.io/api \
  --etherscan-api-key $SNOWTRACE_API_KEY \
  -vvvv
```

Expected gas cost: **~$1–4** (1.8M gas at 25–100 nAVAX).

After deploy, copy the printed addresses to `.env`:
```env
PANORAMA_SWAP_ADDRESS=0x...
PANORAMA_LEND_ADDRESS=0x...
```

---

### Environment Variables

Add to `.env` (Avalanche):

```env
# Avalanche C-Chain
AVAX_RPC_URL=https://api.avax.network/ext/bc/C/rpc
SNOWTRACE_API_KEY=your_key_here
PANORAMA_SWAP_ADDRESS=           # filled after deploy
PANORAMA_LEND_ADDRESS=           # filled after deploy
```

---

## Base Layer (Hackathon)

Built for the **Base Hackathon 2026**. Deployed on Base mainnet.

| Contract | Address |
|---|---|
| **PanoramaExecutor** | [`0x79D671250f75631ca199d0Fa22b0071052214172`](https://basescan.org/address/0x79D671250f75631ca199d0Fa22b0071052214172) |
| **AerodromeAdapter** | [`0xf919A01510591f38407AA4BBE5711646DB6819e3`](https://basescan.org/address/0xf919A01510591f38407AA4BBE5711646DB6819e3) |
| **DCAVault** | [`0x748bC7b2c12F5c97F72d19d599118A7672cAc45B`](https://basescan.org/address/0x748bC7b2c12F5c97F72d19d599118A7672cAc45B) |

Base routes: `/swap`, `/staking`, `/dca` — see original module files for details.

---

## Project Structure

```
execution-layer/
│
├── contracts/
│   ├── avax/                         ← Avalanche C-Chain (NEW)
│   │   ├── core/
│   │   │   └── PanoramaSwap.sol      ← Trader Joe V1 wrapper
│   │   ├── lending/
│   │   │   └── PanoramaLend.sol      ← Benqi wrapper
│   │   └── interfaces/
│   │       ├── ITraderJoeRouter.sol
│   │       └── IBenqiToken.sol
│   │
│   └── aerodrome/                    ← Base (hackathon)
│       ├── core/
│       │   ├── PanoramaExecutor.sol
│       │   └── DCAVault.sol
│       ├── adapters/
│       │   └── AerodromeAdapter.sol
│       └── interfaces/
│
├── backend/src/
│   ├── index.ts                      ← registers all routes
│   ├── config/
│   │   └── chains.ts                 ← base + avalanche configs
│   ├── shared/services/
│   │   ├── aerodrome.service.ts      ← Base/Aerodrome queries
│   │   └── avax.service.ts           ← Avalanche queries (NEW)
│   ├── utils/
│   │   └── abi.ts                    ← all contract ABIs
│   │
│   └── modules/
│       ├── avax-swap/                ← Avalanche swap (NEW)
│       │   ├── config/avax-swap-pairs.ts
│       │   ├── usecases/
│       │   │   ├── get-quote.usecase.ts
│       │   │   └── prepare-swap.usecase.ts
│       │   ├── controllers/avax-swap.controller.ts
│       │   └── routes/avax-swap.routes.ts
│       │
│       ├── avax-lending/             ← Avalanche lending (NEW)
│       │   ├── config/avax-lending-markets.ts
│       │   ├── usecases/
│       │   │   ├── prepare-supply.usecase.ts
│       │   │   ├── prepare-redeem.usecase.ts
│       │   │   ├── prepare-borrow.usecase.ts
│       │   │   └── prepare-repay.usecase.ts
│       │   ├── controllers/avax-lending.controller.ts
│       │   └── routes/avax-lending.routes.ts
│       │
│       ├── swap/                     ← Base swap
│       ├── liquid-staking/           ← Base staking
│       └── dca/                      ← Base DCA
│
├── script/
│   ├── avax/
│   │   └── DeployAvax.s.sol          ← deploys PanoramaSwap + PanoramaLend (NEW)
│   ├── Deploy.s.sol                  ← Base deploy
│   └── DeployDCAVault.s.sol
│
└── test/
    ├── avax/                         ← Avalanche tests (NEW)
    │   ├── mocks/
    │   │   ├── MockTraderJoeRouter.sol
    │   │   └── MockBenqi.sol
    │   ├── PanoramaSwap.t.sol        ← 17 unit tests
    │   ├── PanoramaLend.t.sol        ← 29 unit tests
    │   └── fork/
    │       ├── PanoramaSwapFork.t.sol ← 4 fork tests (Avalanche mainnet)
    │       └── PanoramaLendFork.t.sol ← 2 fork tests + 2 skipped
    ├── PanoramaExecutor.t.sol
    └── DCAVault.t.sol
```

---

## Running Locally

```bash
# Install backend dependencies
cd backend && npm install

# Install Foundry libraries
forge install

# Copy and fill env
cp .env.example .env

# Run backend
cd backend && npm run dev
# → http://localhost:3010

# Health check
curl http://localhost:3010/health
```

---

## Tests

```bash
# Unit tests — no RPC needed (54 tests: 52 pass, 2 skipped)
forge test --match-path "test/avax/**" -vv

# Fork tests — requires AVAX_RPC_URL
AVAX_RPC_URL=https://api.avax.network/ext/bc/C/rpc \
  forge test --match-path "test/avax/fork/**" -vvv

# Base unit tests
forge test --no-match-path "test/avax/**" --no-match-path "test/fork/**" -vv
```

**Test results (Avalanche):**

| Suite | Tests | Result |
|---|---|---|
| `PanoramaSwap.t.sol` | 17 | all pass |
| `PanoramaLend.t.sol` | 29 | all pass |
| `PanoramaSwapFork.t.sol` | 4 | all pass (against Avalanche mainnet) |
| `PanoramaLendFork.t.sol` | 4 | 2 pass, 2 skipped* |

*qiUSDC market has mint paused by Benqi governance. Logic is identical to qiAVAX (proven passing).

---

## Supported Tokens (Avalanche)

| Symbol | Address | Decimals |
|---|---|---|
| WAVAX | `0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7` | 18 |
| USDC | `0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E` | 6 |
| USDC.e | `0xA7D7079b0FEaD91F3e65f86E8915Cb59c1a4C664` | 6 |
| USDT | `0x9702230A8Ea53601f5cD2dc00fDBc13d4dF4A8c7` | 6 |
| WETH.e | `0x49D5c2BdFfac6CE2BFdB6640F4F80f226bc10bAB` | 18 |
| BTC.b | `0x152b9d0FdC40C096757F570A51E494bd4b943E50` | 8 |

## Supported Swap Pairs (Avalanche)

| Pair | ID |
|---|---|
| AVAX → USDC | `avax-usdc` |
| USDC → AVAX | `usdc-avax` |
| AVAX → USDT | `avax-usdt` |
| USDT → AVAX | `usdt-avax` |
| USDC → USDT | `usdc-usdt` |
| USDT → USDC | `usdt-usdc` |
| AVAX → WETH | `avax-weth` |
| WETH → AVAX | `weth-avax` |

## Supported Lending Markets (Avalanche)

| Market | qToken | Underlying | ID |
|---|---|---|---|
| AVAX | `qiAVAX` | Native AVAX | `avax` |
| USDC.e | `qiUSDC` | USDC.e | `usdc.e` |
| USDT | `qiUSDT` | USDT | `usdt` |
| WETH.e | `qiETH` | WETH.e | `weth` |
