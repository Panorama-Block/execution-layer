# PanoramaBlock Execution Layer

On-chain execution infrastructure for DeFi operations on Base. Routes operations through a central executor contract to registered protocol adapters.

Built for the **Base Hackathon 2026**.

## Table of Contents

- [Architecture](#architecture)
- [Deployed Contracts (Base Mainnet)](#deployed-contracts-base-mainnet)
- [Project Structure](#project-structure)
- [Getting Started](#getting-started)
- [API Endpoints](#api-endpoints)
- [Creating a New Service Module](#creating-a-new-service-module)
- [Shared Utilities](#shared-utilities)
- [Supported Chains](#supported-chains)
- [Tech Stack](#tech-stack)

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                      Frontend                            │
│              (connects wallet, signs txs)                 │
└───────────────────────┬─────────────────────────────────┘
                        │ HTTP
┌───────────────────────▼─────────────────────────────────┐
│                   Backend (Express)                       │
│                                                           │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐      │
│  │Liquid Staking│ │  Swap (WIP)  │ │   DCA (WIP)  │      │
│  │   Module     │ │   Module     │ │   Module     │      │
│  └──────────────┘ └──────────────┘ └──────────────┘      │
│                                                           │
│  Prepares unsigned transaction bundles (non-custodial)    │
└───────────────────────┬─────────────────────────────────┘
                        │ On-chain calls
┌───────────────────────▼─────────────────────────────────┐
│              Smart Contracts (Base Mainnet)                │
│                                                           │
│  ┌─────────────────────────────────────────┐              │
│  │          PanoramaExecutor (core)         │              │
│  │    Routes calls to protocol adapters     │              │
│  └──────────────────┬──────────────────────┘              │
│                     │ registerAdapter()                    │
│  ┌──────────────────▼──────────────────────┐              │
│  │        AerodromeAdapter                  │              │
│  │  swap / addLiquidity / removeLiquidity   │              │
│  │  stake / unstake                         │              │
│  └─────────────────────────────────────────┘              │
│                                                           │
│  ┌─────────────────────────────────────────┐              │
│  │   Future: AaveLendingAdapter, etc.       │              │
│  └─────────────────────────────────────────┘              │
└─────────────────────────────────────────────────────────┘
```

### How it works

1. **Backend** receives a request (e.g., "enter staking position with 0.01 WETH + 10 USDC")
2. Backend queries on-chain state (allowances, pool addresses, gauge addresses)
3. Backend builds an ordered **TransactionBundle** (approve → addLiquidity → stake)
4. Frontend receives the bundle, signs each transaction with MetaMask, and submits to Base
5. **PanoramaExecutor** routes each call to the registered **AerodromeAdapter**
6. Adapter interacts with Aerodrome contracts (Router, Factory, Gauge)

The backend **never holds private keys**. It only prepares unsigned calldata.

---

## Deployed Contracts (Base Mainnet)

| Contract | Address |
|---|---|
| **PanoramaExecutor** | [`0x79D671250f75631ca199d0Fa22b0071052214172`](https://basescan.org/address/0x79D671250f75631ca199d0Fa22b0071052214172) |
| **AerodromeAdapter** | [`0xf919A01510591f38407AA4BBE5711646DB6819e3`](https://basescan.org/address/0xf919A01510591f38407AA4BBE5711646DB6819e3) |
| **DCAVault** | [`0x155eC4256cC6f11f3d4C21Af28a2a1CC31f730d1`](https://basescan.org/address/0x155eC4256cC6f11f3d4C21Af28a2a1CC31f730d1) |

- **PanoramaExecutor** is the single entry point for swap, liquidity, and staking operations. Deploy once, use forever.
- **AerodromeAdapter** handles swap, liquidity, and staking on Aerodrome Finance. Already deployed and registered.
- **DCAVault** stores user DCA orders and deposits. A trusted keeper calls `execute(orderId)` at each interval to trigger swaps via PanoramaExecutor.

### When do I need a new adapter?

| Service | Needs new adapter? | Why |
|---|---|---|
| Swap (Aerodrome) | **No** | `AerodromeAdapter.swap()` already exists |
| Liquid Staking (Aerodrome) | **No** | `AerodromeAdapter.stake()/unstake()` already exists |
| DCA (Aerodrome) | **No** | `DCAVault` routes through existing `PanoramaExecutor` |
| Lending (Aave/Compound) | **Yes** | New protocol = new adapter (e.g., `AaveLendingAdapter`) |
| Swap (other DEX) | **Yes** | New protocol = new adapter (e.g., `UniswapAdapter`) |

To register a new adapter:
```solidity
// Only the executor owner can register adapters
executor.registerAdapter(keccak256("aave"), aaveLendingAdapterAddress);
```

---

## Project Structure

```
execution-layer/
├── contracts/                    # Solidity smart contracts
│   ├── core/
│   │   ├── PanoramaExecutor.sol  # Central router (deployed)
│   │   └── DCAVault.sol          # DCA order vault (deployed)
│   ├── adapters/
│   │   └── AerodromeAdapter.sol  # Aerodrome integration (deployed)
│   ├── interfaces/
│   │   ├── IProtocolAdapter.sol
│   │   ├── IAerodromeRouter.sol
│   │   ├── IAerodromeGauge.sol
│   │   └── IERC20.sol
│   └── libraries/
│       └── SafeTransferLib.sol
│
├── backend/
│   └── src/
│       ├── index.ts              # Express server entry point
│       ├── config/
│       │   ├── chains.ts         # Chain configs (lazy env loading)
│       │   └── protocols.ts      # Protocol configs (Aerodrome addresses, tokens)
│       ├── providers/
│       │   ├── chain.provider.ts
│       │   ├── aerodrome.provider.ts
│       │   └── gauge.provider.ts
│       ├── types/
│       │   └── transaction.ts    # PreparedTransaction, TransactionBundle
│       ├── utils/
│       │   ├── abi.ts            # Contract ABIs (incl. DCA_VAULT_ABI)
│       │   └── encoding.ts       # Helpers (protocolId via keccak256, deadline, slippage)
│       ├── usecases/             # Shared usecases (approve, allowance, swap, stake)
│       ├── controllers/
│       │   └── execution.controller.ts
│       ├── routes/
│       │   └── execution.routes.ts
│       └── modules/              # Service modules (one per product)
│           ├── liquid-staking/   # Liquid Staking module (complete)
│           │   ├── config/staking-pools.ts
│           │   ├── usecases/
│           │   │   ├── prepare-enter-strategy.usecase.ts
│           │   │   ├── prepare-exit-strategy.usecase.ts
│           │   │   ├── prepare-claim-rewards.usecase.ts
│           │   │   ├── get-staking-pools.usecase.ts
│           │   │   └── get-position.usecase.ts
│           │   ├── controllers/staking.controller.ts
│           │   └── routes/staking.routes.ts
│           ├── swap/             # Swap module (complete)
│           │   ├── config/swap-pairs.ts
│           │   ├── usecases/
│           │   │   ├── prepare-swap.usecase.ts   # Bundle: approve? → swap
│           │   │   ├── get-quote.usecase.ts
│           │   │   └── get-swap-pairs.usecase.ts
│           │   ├── controllers/swap.controller.ts
│           │   └── routes/swap.routes.ts
│           └── dca/              # DCA module (complete)
│               ├── usecases/
│               │   ├── prepare-create-order.usecase.ts  # Bundle: approve → createOrder
│               │   ├── prepare-cancel-order.usecase.ts  # Bundle: cancel → withdraw?
│               │   ├── get-orders.usecase.ts
│               │   └── get-executable-orders.usecase.ts # Keeper endpoint
│               ├── controllers/dca.controller.ts
│               └── routes/dca.routes.ts
│
├── frontend/
│   └── index.html                # Demo UI — Staking, Swap, DCA tabs
│
├── script/
│   ├── Deploy.s.sol              # PanoramaExecutor + AerodromeAdapter deploy
│   ├── DeployDCAVault.s.sol      # DCAVault deploy
│   └── DeployTestnet.s.sol       # Base Sepolia deploy
│
└── test/
    ├── PanoramaExecutor.t.sol    # Unit tests (13 tests)
    ├── mocks/
    └── fork/
        ├── AerodromeAdapter.t.sol
        └── AerodromeFork.t.sol   # Full flow fork tests (5 tests)
```

---

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) >= 18
- [Foundry](https://book.getfoundry.sh/) (for smart contracts)

### 1. Install dependencies

```bash
# Backend
cd backend
npm install

# Contracts (Foundry)
cd ..
forge install
```

### 2. Configure environment

```bash
# Backend .env
cp backend/.env.example backend/.env
```

The contracts are **already deployed**. Use these addresses in `backend/.env`:

```env
PORT=3010
BASE_RPC_URL=https://mainnet.base.org
EXECUTOR_ADDRESS=0x79D671250f75631ca199d0Fa22b0071052214172
AERODROME_ADAPTER_ADDRESS=0xf919A01510591f38407AA4BBE5711646DB6819e3
```

### 3. Run the backend

```bash
cd backend
npm run dev
# execution-service running on port 3010
```

### 4. Run the frontend

```bash
cd frontend
python3 -m http.server 5173
# Open http://localhost:5173
```

### 5. Run tests

```bash
# Unit tests (no RPC needed)
forge test -vv --no-match-path "test/fork/*"

# Fork tests (against Base mainnet)
BASE_RPC_URL=https://mainnet.base.org forge test --match-path "test/fork/*" -vvv
```

---

## API Endpoints

### Liquid Staking (`/staking`)

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/staking/pools` | List staking pools with on-chain data |
| `GET` | `/staking/position/:userAddress` | Get user positions and earned rewards |
| `POST` | `/staking/prepare-enter` | Bundle: approve → addLiquidity → stake |
| `POST` | `/staking/prepare-exit` | Bundle: unstake → approve → removeLiquidity |
| `POST` | `/staking/prepare-claim` | Single tx: claim AERO rewards |

### Swap (`/swap`)

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/swap/pairs` | List available pairs with on-chain reserves |
| `POST` | `/swap/quote` | Get quote: amountOut, amountOutMin, exchangeRate |
| `POST` | `/swap/prepare` | Bundle: approve (if needed) → executeSwap |

### DCA (`/dca`)

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/dca/prepare-create` | Bundle: approve → createOrder on DCAVault |
| `POST` | `/dca/prepare-cancel` | Bundle: cancel → withdraw remaining balance |
| `GET` | `/dca/orders/:userAddress` | List all DCA orders for a user |
| `GET` | `/dca/order/:orderId` | Get single order with on-chain state |
| `GET` | `/dca/executable?upTo=100` | **Keeper endpoint** — orders ready to execute now |

### Core Execution (`/execution`)

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/execution/prepare-swap` | Low-level single swap tx (no allowance check) |
| `POST` | `/execution/prepare-approve` | Prepare ERC-20 approval |
| `POST` | `/execution/check-allowance` | Check token allowance |
| `GET` | `/execution/pools` | List Aerodrome pools |
| `POST` | `/execution/quote` | Get swap quote |

### Example: Enter Staking Position

```bash
curl -X POST http://localhost:3010/staking/prepare-enter \
  -H "Content-Type: application/json" \
  -d '{
    "userAddress": "0xYourAddress",
    "poolId": "weth-usdc-volatile",
    "amountA": "10000000000000000",
    "amountB": "10000000",
    "slippageBps": 100,
    "deadlineMinutes": 20
  }'
```

Response returns a `TransactionBundle` with ordered steps:

```json
{
  "bundle": {
    "steps": [
      { "to": "0x...", "data": "0x...", "value": "0", "description": "Approve WETH to Executor" },
      { "to": "0x...", "data": "0x...", "value": "0", "description": "Approve USDC to Executor" },
      { "to": "0x...", "data": "0x...", "value": "0", "description": "Add liquidity to WETH/USDC Volatile" },
      { "to": "0x...", "data": "0x...", "value": "0", "description": "Approve LP token to Executor" },
      { "to": "0x...", "data": "0x...", "value": "0", "description": "Stake LP in gauge" }
    ],
    "totalSteps": 5,
    "summary": "Enter staking position: WETH/USDC Volatile"
  },
  "metadata": {
    "poolAddress": "0xcDAC0d6c6C59727a65F871236188350531885C43",
    "gaugeAddress": "0x519BBD1Dd8C6A94C46080E24f316c14Ee758C025"
  }
}
```

The frontend signs and submits each step sequentially via MetaMask.

---

## Creating a New Service Module

Follow the `liquid-staking` module as reference. Each module lives in `backend/src/modules/<module-name>/`.

### Step 1: Create module folder structure

```
backend/src/modules/your-service/
├── config/
│   └── your-config.ts          # Pool/market/strategy definitions
├── usecases/
│   ├── prepare-enter.usecase.ts
│   ├── prepare-exit.usecase.ts
│   └── get-data.usecase.ts
├── controllers/
│   └── your-service.controller.ts
└── routes/
    └── your-service.routes.ts
```

### Step 2: Implement usecases

Each usecase returns a `PreparedTransaction` or `TransactionBundle`:

```typescript
import { ethers } from "ethers";
import { getChainConfig } from "../../../config/chains";
import { PANORAMA_EXECUTOR_ABI } from "../../../utils/abi";
import { encodeProtocolId, getDeadline } from "../../../utils/encoding";
import { PreparedTransaction, TransactionBundle } from "../../../types/transaction";

export async function executeYourStrategy(req: YourRequest): Promise<{ bundle: TransactionBundle }> {
  const chain = getChainConfig("base");
  const executorAddress = chain.contracts.panoramaExecutor;
  const executorIface = new ethers.Interface(PANORAMA_EXECUTOR_ABI);
  const protocolId = encodeProtocolId("aerodrome"); // or your protocol
  const deadline = getDeadline(20);

  const steps: PreparedTransaction[] = [];

  // Add approve steps if needed (check allowance first)
  // ...

  // Add the main operation
  steps.push({
    to: executorAddress,
    data: executorIface.encodeFunctionData("executeSwap", [
      protocolId, tokenIn, tokenOut, amountIn, amountOutMin, extraData, deadline,
    ]),
    value: "0",
    chainId: chain.chainId,
    description: "Execute swap via PanoramaExecutor",
  });

  return {
    bundle: {
      steps,
      totalSteps: steps.length,
      summary: "Your strategy description",
    },
  };
}
```

### Step 3: Create controller

```typescript
import { Request, Response } from "express";
import { executeYourStrategy } from "../usecases/prepare-enter.usecase";

export async function prepareEnter(req: Request, res: Response) {
  try {
    const result = await executeYourStrategy(req.body);
    return res.json(result);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
}
```

### Step 4: Create routes

```typescript
import { Router } from "express";
import { prepareEnter } from "../controllers/your-service.controller";

export const yourServiceRoutes = Router();
yourServiceRoutes.post("/prepare-enter", prepareEnter);
```

### Step 5: Register in `backend/src/index.ts`

```typescript
import { yourServiceRoutes } from "./modules/your-service/routes/your-service.routes";
app.use("/your-service", yourServiceRoutes);
```

### Step 6: New protocol? Deploy a new adapter

If your service uses a protocol **other than Aerodrome**, you need a new adapter:

1. Create `contracts/adapters/YourAdapter.sol` implementing `IProtocolAdapter`
2. Deploy: `forge script script/DeployYourAdapter.s.sol --rpc-url $BASE_RPC_URL --broadcast`
3. Register: `executor.registerAdapter(keccak256("your-protocol"), adapterAddress)`
4. Add the adapter address to `backend/src/config/protocols.ts`

If your service uses **Aerodrome** (swap, liquidity, staking), the existing `AerodromeAdapter` already handles it — **no new deployment needed**.

### IProtocolAdapter Interface

All adapters must implement these functions:

```solidity
interface IProtocolAdapter {
    function swap(address tokenIn, address tokenOut, uint256 amountIn,
        uint256 amountOutMin, address recipient, bytes calldata extraData)
        external payable returns (uint256 amountOut);

    function addLiquidity(address tokenA, address tokenB, bool stable,
        uint256 amountADesired, uint256 amountBDesired, uint256 amountAMin,
        uint256 amountBMin, address recipient, bytes calldata extraData)
        external payable returns (uint256 liquidity);

    function removeLiquidity(address tokenA, address tokenB, bool stable,
        uint256 liquidity, uint256 amountAMin, uint256 amountBMin,
        address recipient, bytes calldata extraData)
        external payable returns (uint256 amountA, uint256 amountB);

    function stake(address lpToken, uint256 amount, bytes calldata extraData)
        external returns (bool);

    function unstake(address lpToken, uint256 amount, bytes calldata extraData)
        external returns (bool);
}
```

---

## Shared Utilities

Reuse these across all modules:

| Utility | Import | Description |
|---|---|---|
| `encodeProtocolId(name)` | `utils/encoding.ts` | `keccak256("aerodrome")` → bytes32 |
| `getDeadline(minutes)` | `utils/encoding.ts` | Current timestamp + minutes |
| `applySlippage(amount, bps)` | `utils/encoding.ts` | Slippage protection (100 bps = 1%) |
| `getContract(addr, abi, chain)` | `providers/chain.provider.ts` | ethers.js Contract instance |
| `getPoolAddress(tokenA, tokenB, stable)` | `providers/aerodrome.provider.ts` | Resolve pool on-chain |
| `getGaugeForPool(pool)` | `providers/gauge.provider.ts` | Resolve gauge via Voter |
| `PreparedTransaction` | `types/transaction.ts` | `{ to, data, value, chainId, description }` |
| `TransactionBundle` | `types/transaction.ts` | `{ steps[], totalSteps, summary }` |

---

## Supported Chains

| Chain | Status | Primary Protocol |
|-------|--------|-----------------|
| Base | **Active** | Aerodrome Finance |
| Avalanche | Planned | TBD |
| Arbitrum | Planned | TBD |

---

## Tech Stack

| Layer | Technology |
|---|---|
| Smart Contracts | Solidity 0.8.20, Foundry |
| Backend | Node.js, Express, ethers.js v6, TypeScript |
| Frontend | Vanilla HTML/JS, ethers.js v6 |
| Chain | Base Mainnet (Chain ID 8453) |
| DEX | Aerodrome Finance (Router2, Voter, Gauges) |
