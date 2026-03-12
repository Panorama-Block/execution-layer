# PanoramaBlock Execution Layer

On-chain execution infrastructure for DeFi operations on Base. Routes operations through a fully **protocol-neutral** central executor to registered protocol adapters.

Built for the **Base Hackathon 2026**.

## Table of Contents

- [Architecture](#architecture)
- [Protocol Neutrality](#protocol-neutrality)
- [Deployed Contracts (Base Mainnet)](#deployed-contracts-base-mainnet)
- [Project Structure](#project-structure)
- [Getting Started](#getting-started)
- [API Endpoints](#api-endpoints)
- [Creating a New Service Module](#creating-a-new-service-module)
- [Adding a New Protocol](#adding-a-new-protocol)
- [Shared Utilities](#shared-utilities)
- [Supported Chains](#supported-chains)
- [Tech Stack](#tech-stack)

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                      Frontend                            │
│              (connects wallet, signs txs)                │
└───────────────────────┬─────────────────────────────────┘
                        │ HTTP
┌───────────────────────▼─────────────────────────────────┐
│                   Backend (Express)                       │
│                                                           │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐      │
│  │Liquid Staking│ │     Swap     │ │     DCA      │      │
│  │   Module     │ │   Module     │ │   Module     │      │
│  └──────────────┘ └──────────────┘ └──────────────┘      │
│          │               │               │                │
│          └───────────────▼───────────────┘                │
│                  BundleBuilder (shared)                   │
│       Prepares unsigned transaction bundles               │
│       execute(protocolId, action, transfers, data)        │
└───────────────────────┬─────────────────────────────────┘
                        │ On-chain calls
┌───────────────────────▼─────────────────────────────────┐
│              Smart Contracts (Base Mainnet)               │
│                                                           │
│  ┌──────────────────────────────────────────────────┐     │
│  │          PanoramaExecutor (protocol-neutral)      │     │
│  │  Single entry point: execute(protocolId, action,  │     │
│  │    transfers, deadline, data)                     │     │
│  │  Creates per-user clones (EIP-1167)               │     │
│  └──────────────────┬───────────────────────────────┘     │
│                     │ low-level call(action, data)         │
│  ┌──────────────────▼───────────────────────────────┐     │
│  │   IProtocolAdapter (interface)                    │     │
│  │   swap / addLiquidity / removeLiquidity           │     │
│  │   stake / unstake / claimRewards                  │     │
│  └──────────────────┬───────────────────────────────┘     │
│                     │                                      │
│  ┌──────────────────▼───────────────────────────────┐     │
│  │   AerodromeAdapter  │  VelodromeAdapter (future) │     │
│  │   UniswapAdapter    │  AaveAdapter (future)       │     │
│  └──────────────────┬───────────────────────────────┘     │
│                     │ EIP-1167 minimal proxy clones        │
│  ┌──────────────────▼───────────────────────────────┐     │
│  │  User Clone A │ User Clone B │ Clone N  │ ...    │     │
│  │  (isolated)   │ (isolated)   │          │        │     │
│  └──────────────────────────────────────────────────┘     │
└─────────────────────────────────────────────────────────┘
```

### How it works

1. **Backend** receives a request (e.g., "enter staking position with 0.01 WETH + 10 USDC")
2. Backend queries on-chain state (allowances, pool addresses, gauge addresses)
3. Backend builds an ordered **TransactionBundle** using `BundleBuilder` (approve → addLiquidity → stake)
4. Frontend receives the bundle, signs each transaction with MetaMask, and submits to Base
5. **PanoramaExecutor.execute()** creates (or reuses) a **per-user adapter clone** via EIP-1167
6. The user's clone interacts with protocol contracts (Router, Factory, Gauge) — positions are fully isolated

The backend **never holds private keys**. It only prepares unsigned calldata.

---

## Protocol Neutrality

`PanoramaExecutor` is fully protocol-neutral. It has a **single entry point**:

```solidity
function execute(
    bytes32 protocolId,
    bytes4 action,
    Transfer[] calldata transfers,
    uint256 deadline,
    bytes calldata data
) external payable returns (bytes memory result)
```

The executor has **zero knowledge** of action semantics. It only:
1. Creates/retrieves the user's adapter clone for `protocolId`
2. Pulls ERC-20 tokens from the user into the adapter (`transfers`)
3. Calls the adapter via `adapter.call(action ++ data)` — a raw low-level dispatch

This means:
- **Adding a new protocol**: deploy an adapter → `registerAdapter(keccak256("yourprotocol"), addr)`. No contract changes.
- **Adding a new action**: implement it on the adapter. No executor changes.
- **The executor never needs redeployment** as the protocol ecosystem grows.

### Adapter selectors (backend ↔ contract)

The backend's `ADAPTER_SELECTORS` uses proper Solidity function selectors:

| Action | Selector |
|--------|---------|
| `swap` | `bytes4(keccak256("swap(address,address,uint256,uint256,address,bool)"))` |
| `addLiquidity` | `bytes4(keccak256("addLiquidity(address,address,bool,uint256,uint256,uint256,uint256,address)"))` |
| `removeLiquidity` | `bytes4(keccak256("removeLiquidity(address,address,bool,uint256,uint256,uint256,address,address)"))` |
| `stake` | `bytes4(keccak256("stake(address,uint256,address)"))` |
| `unstake` | `bytes4(keccak256("unstake(address,uint256,address,address)"))` |
| `claimRewards` | `bytes4(keccak256("claimRewards(address,address,address)"))` |

### Per-user adapter clones (EIP-1167)

Each user gets their own adapter clone on first interaction (~45k gas, one-time). The clone is a minimal proxy that delegates all logic to the registered adapter implementation but has its own storage:

- **Isolated positions**: Each user's gauge deposits, LP tokens, and rewards are separate
- **Deterministic addresses**: Backend predicts clone addresses via `predictUserAdapter(protocolId, user)` — no on-chain state needed
- **No shared accounting**: No per-user mappings or off-chain ledgers required

---

## Deployed Contracts (Base Mainnet)

| Contract | Address |
|---|---|
| **PanoramaExecutor** | [`0x79D671250f75631ca199d0Fa22b0071052214172`](https://basescan.org/address/0x79D671250f75631ca199d0Fa22b0071052214172) |
| **AerodromeAdapter** | [`0xf919A01510591f38407AA4BBE5711646DB6819e3`](https://basescan.org/address/0xf919A01510591f38407AA4BBE5711646DB6819e3) |
| **DCAVault** | [`0x748bC7b2c12F5c97F72d19d599118A7672cAc45B`](https://basescan.org/address/0x748bC7b2c12F5c97F72d19d599118A7672cAc45B) |

> **Note:** The deployed `PanoramaExecutor` needs to be redeployed to include the new `execute()` function. The `AerodromeAdapter` also needs redeployment with updated flat-parameter signatures. The `DCAVault` is unaffected.

---

## Project Structure

```
execution-layer/
├── contracts/                    # Solidity smart contracts
│   ├── core/
│   │   ├── PanoramaExecutor.sol  # Protocol-neutral dispatcher (execute())
│   │   └── DCAVault.sol          # DCA order vault
│   ├── adapters/
│   │   └── AerodromeAdapter.sol  # Aerodrome integration (flat typed params)
│   ├── interfaces/
│   │   ├── IPanoramaExecutor.sol # Executor interface (Transfer struct + execute())
│   │   ├── IProtocolAdapter.sol  # Adapter action interface
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
│       │   ├── chains.ts         # Chain configs
│       │   └── protocols.ts      # Protocol registry (registerProtocol / getProtocolConfig)
│       ├── shared/
│       │   ├── bundle-builder.ts # BundleBuilder + ADAPTER_SELECTORS
│       │   ├── aerodrome-swap.ts # buildAerodromeSwapBundle()
│       │   └── services/
│       │       └── aerodrome.service.ts  # Singleton for all Aerodrome on-chain reads
│       ├── providers/
│       │   ├── chain.provider.ts
│       │   ├── aerodrome.provider.ts
│       │   └── gauge.provider.ts
│       ├── types/
│       │   └── transaction.ts    # PreparedTransaction, TransactionBundle
│       ├── utils/
│       │   ├── abi.ts            # Contract ABIs
│       │   └── encoding.ts       # encodeProtocolId, applySlippage, getDeadline
│       ├── usecases/
│       │   └── swap-provider.usecase.ts  # External Liquid Swap Service adapter
│       └── modules/              # Service modules (one per product)
│           ├── liquid-staking/
│           │   ├── config/staking-pools.ts
│           │   └── usecases/
│           │       ├── prepare-enter-strategy.usecase.ts
│           │       ├── prepare-exit-strategy.usecase.ts
│           │       ├── prepare-claim-rewards.usecase.ts
│           │       ├── get-staking-pools.usecase.ts
│           │       └── get-position.usecase.ts
│           ├── swap/
│           │   └── usecases/
│           │       ├── prepare-swap.usecase.ts
│           │       ├── get-quote.usecase.ts
│           │       └── get-swap-pairs.usecase.ts
│           └── dca/
│               └── usecases/
│                   ├── prepare-create-order.usecase.ts
│                   ├── prepare-cancel-order.usecase.ts
│                   ├── get-orders.usecase.ts
│                   └── get-executable-orders.usecase.ts
│
├── frontend/
│   └── index.html                # Demo UI — Staking, Swap, DCA tabs
│
├── script/
│   ├── Deploy.s.sol
│   ├── DeployDCAVault.s.sol
│   └── DeployTestnet.s.sol
│
└── test/
    ├── PanoramaExecutor.t.sol    # Unit tests — execute() dispatch
    ├── DCAVault.t.sol
    ├── mocks/
    └── fork/
        ├── AerodromeAdapter.t.sol
        └── AerodromeFork.t.sol
```

---

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) >= 18
- [Foundry](https://book.getfoundry.sh/)

### 1. Install dependencies

```bash
cd backend && npm install
cd .. && forge install
```

### 2. Configure environment

```bash
cp backend/.env.example backend/.env
```

```env
PORT=3010
BASE_RPC_URL=https://mainnet.base.org
EXECUTOR_ADDRESS=0x79D671250f75631ca199d0Fa22b0071052214172
AERODROME_ADAPTER_ADDRESS=0xf919A01510591f38407AA4BBE5711646DB6819e3
DCA_VAULT_ADDRESS=0x748bC7b2c12F5c97F72d19d599118A7672cAc45B
```

### 3. Run the backend

```bash
# Docker (recommended)
docker compose up -d --build

# Or locally
cd backend && npm run dev
```

### 4. Run tests

```bash
# Solidity unit tests (no RPC needed)
forge test -vv --no-match-path "test/fork/*"

# Solidity fork tests (Base mainnet)
BASE_RPC_URL=https://mainnet.base.org forge test --match-path "test/fork/*" -vvv

# Backend unit + integration tests
cd backend && npm test
```

---

## API Endpoints

### Liquid Staking (`/staking`)

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/staking/pools` | List staking pools with on-chain data |
| `GET` | `/staking/position/:userAddress` | User positions and earned rewards |
| `POST` | `/staking/prepare-enter` | Bundle: approve → addLiquidity → stake |
| `POST` | `/staking/prepare-exit` | Bundle: unstake → approve → removeLiquidity |
| `POST` | `/staking/prepare-claim` | Single tx: claim AERO rewards |

### Swap (`/swap`)

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/swap/pairs` | Available pairs with on-chain reserves |
| `POST` | `/swap/quote` | Quote: amountOut, amountOutMin, exchangeRate |
| `POST` | `/swap/prepare` | Bundle: approve (if needed) → swap |

### DCA (`/dca`)

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/dca/prepare-create` | Bundle: approve → createOrder |
| `POST` | `/dca/prepare-cancel` | Bundle: cancel → withdraw remaining balance |
| `GET` | `/dca/orders/:userAddress` | List all DCA orders |
| `GET` | `/dca/order/:orderId` | Single order with on-chain state |
| `GET` | `/dca/executable?upTo=100` | **Keeper endpoint** — orders ready to execute |

### External Swap Provider (`/provider/swap`)

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/provider/swap/supports` | Check if route is supported |
| `POST` | `/provider/swap/quote` | Get swap quote for external service |
| `POST` | `/provider/swap/prepare` | Prepare bundle for external service |

### Example: Enter Staking Position

```bash
curl -X POST http://localhost:3010/staking/prepare-enter \
  -H "Content-Type: application/json" \
  -d '{
    "userAddress": "0xYourAddress",
    "poolId": "weth-usdc-volatile",
    "amountA": "10000000000000000",
    "amountB": "10000000",
    "slippageBps": 100
  }'
```

Response:

```json
{
  "bundle": {
    "steps": [
      { "to": "0x...", "data": "0x...", "value": "0", "description": "Approve WETH" },
      { "to": "0x...", "data": "0x...", "value": "0", "description": "Approve USDC" },
      { "to": "0x...", "data": "0x...", "value": "0", "description": "Add liquidity to WETH/USDC Volatile" },
      { "to": "0x...", "data": "0x...", "value": "0", "description": "Approve LP token" },
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

Every `to: executor` step encodes `PanoramaExecutor.execute(protocolId, action, transfers, deadline, data)`.

---

## Creating a New Service Module

Follow the `liquid-staking` module as reference. Each module lives in `backend/src/modules/<module-name>/`.

### Step 1: Module folder structure

```
backend/src/modules/your-service/
├── config/your-config.ts
├── usecases/
│   ├── prepare-enter.usecase.ts
│   └── get-data.usecase.ts
├── controllers/your-service.controller.ts
└── routes/your-service.routes.ts
```

### Step 2: Implement usecase with BundleBuilder

```typescript
import { BundleBuilder, ADAPTER_SELECTORS } from "../../../shared/bundle-builder";
import { encodeProtocolId, getDeadline, applySlippage } from "../../../utils/encoding";
import { getChainConfig } from "../../../config/chains";
import { ethers } from "ethers";

export async function executePrepareMyAction(req: MyRequest) {
  const chain    = getChainConfig("base");
  const executor = chain.contracts.panoramaExecutor;
  const protocolId = encodeProtocolId("aerodrome"); // or your protocol
  const deadline   = getDeadline(20);
  const builder    = new BundleBuilder(chain.chainId);

  // 1. Check allowance and add approve step if needed
  builder.addApproveIfNeeded(tokenAddress, executor, currentAllowance, amount, "Approve token");

  // 2. Encode adapter params (must match IProtocolAdapter function signature exactly)
  const adapterData = ethers.AbiCoder.defaultAbiCoder().encode(
    ["address", "address", "uint256", "uint256", "address", "bool"],
    [tokenIn, tokenOut, amountIn, amountOutMin, recipient, stable]
  );

  // 3. Add execute step
  builder.addExecute(
    protocolId, ADAPTER_SELECTORS.SWAP,
    [{ token: tokenIn, amount: amountIn }], deadline, adapterData, 0n,
    executor, "Swap via protocol"
  );

  return { bundle: builder.build("My action") };
}
```

### Step 3: Register in `backend/src/index.ts`

```typescript
import { yourServiceRoutes } from "./modules/your-service/routes/your-service.routes";
app.use("/your-service", yourServiceRoutes);
```

---

## Adding a New Protocol

### 1. Deploy a new adapter contract

```solidity
// contracts/adapters/VelodromeAdapter.sol
contract VelodromeAdapter is IProtocolAdapter {
    function swap(address tokenIn, address tokenOut, uint256 amountIn,
                  uint256 amountOutMin, address recipient, bool stable)
        external payable onlyExecutor returns (uint256 amountOut) { ... }

    function addLiquidity(...) external payable onlyExecutor returns (uint256) { ... }
    function removeLiquidity(...) external onlyExecutor returns (uint256, uint256) { ... }
    function stake(...) external onlyExecutor returns (bool) { ... }
    function unstake(...) external onlyExecutor returns (bool) { ... }
    function claimRewards(...) external onlyExecutor returns (uint256) { ... }
}
```

```bash
forge script script/DeployVelodrome.s.sol --rpc-url $BASE_RPC_URL --broadcast
executor.registerAdapter(keccak256("velodrome"), velodromeAdapterAddress);
```

### 2. Register in the backend

```typescript
// In your module's initialisation file
import { registerProtocol } from "../../../config/protocols";

registerProtocol("velodrome", {
  protocolId: "velodrome",
  name: "Velodrome Finance",
  chain: "optimism",
  contracts: {
    router:  "0x...",
    factory: "0x...",
    voter:   "0x...",
  },
  adapterAddress: process.env.VELODROME_ADAPTER_ADDRESS || "",
});
```

### 3. Use it in your usecase

```typescript
const protocolId = encodeProtocolId("velodrome");
builder.addExecute(protocolId, ADAPTER_SELECTORS.SWAP, transfers, deadline, adapterData, 0n, executor, "Swap via Velodrome");
```

**No changes to `PanoramaExecutor.sol` or `BundleBuilder` are ever needed.**

---

## Shared Utilities

| Utility | Import | Description |
|---|---|---|
| `encodeProtocolId(name)` | `utils/encoding.ts` | `keccak256("aerodrome")` → bytes32 |
| `getDeadline(minutes)` | `utils/encoding.ts` | Current timestamp + N minutes |
| `applySlippage(amount, bps)` | `utils/encoding.ts` | 100 bps = 1% slippage |
| `BundleBuilder` | `shared/bundle-builder.ts` | Fluent tx bundle builder |
| `ADAPTER_SELECTORS` | `shared/bundle-builder.ts` | Solidity function selectors for IProtocolAdapter |
| `registerProtocol(id, config)` | `config/protocols.ts` | Register a new protocol at runtime |
| `getProtocolConfig(id)` | `config/protocols.ts` | Get config for a registered protocol |
| `aerodromeService` | `shared/services/aerodrome.service.ts` | On-chain reads with retry/timeout/caching |
| `getContract(addr, abi, chain)` | `providers/chain.provider.ts` | ethers.js Contract instance |

---

## Supported Chains & Integrations

| Chain | Status | Protocols | Services |
|-------|--------|-----------|---------|
| **Base** | Active | Aerodrome Finance | Swap, Liquid Staking, DCA |
| **Optimism** | Planned | Velodrome Finance | Swap, Staking |
| **Arbitrum** | Planned | TBD | TBD |
| **Avalanche** | Planned | Trader Joe | TBD |

### Current active integrations on Base

| Integration | Type | Status |
|---|---|---|
| Aerodrome Finance (Router2 + Voter + Gauges) | DEX + Staking | Active |
| DCAVault (keeper-based) | Automation | Active |
| External Liquid Swap Service | API adapter | Active (`/provider/swap`) |

---

## Tech Stack

| Layer | Technology |
|---|---|
| Smart Contracts | Solidity 0.8.20, Foundry |
| Backend | Node.js, Express, ethers.js v6, TypeScript |
| Frontend | Vanilla HTML/JS, ethers.js v6 |
| Chain | Base Mainnet (Chain ID 8453) |
| DEX | Aerodrome Finance (Router2, Voter, Gauges) |
| Testing | Foundry (Solidity), Vitest (TypeScript) |
