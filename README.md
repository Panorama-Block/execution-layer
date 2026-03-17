# PanoramaBlock Execution Layer

Non-custodial DeFi execution infrastructure for **Base** and **Avalanche C-Chain**. A protocol-neutral executor routes all operations to registered adapters — the backend prepares unsigned transaction bundles and the user's wallet signs everything client-side.

## Supported Chains & Protocols

| Chain | Protocol | Products |
|---|---|---|
| **Base (8453)** | Aerodrome Finance | Swap, Liquidity Provision, Gauge Staking, DCA |
| **Avalanche (43114)** | Trader Joe V1 | Swap (auto-routes through WAVAX) |
| **Avalanche (43114)** | Benqi Finance | Supply, Borrow, Repay (ERC-20 + native AVAX) |
| **Avalanche (43114)** | BENQI sAVAX | Liquid Staking (stake, unlock, redeem) |

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Frontend / Mini-app                        │
│             (connects wallet, signs transactions)             │
└─────────────────────────┬───────────────────────────────────┘
                          │ HTTP
┌─────────────────────────▼───────────────────────────────────┐
│                   Backend (Express + TypeScript)               │
│                                                               │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌───────────────┐   │
│  │  Swap    │ │ Staking  │ │   DCA    │ │   Lending     │   │
│  │  Base    │ │  Base    │ │  Base    │ │  Avalanche    │   │
│  └──────────┘ └──────────┘ └──────────┘ └───────────────┘   │
│  ┌──────────┐ ┌──────────────────┐                           │
│  │  Swap    │ │ Liquid Staking   │                           │
│  │ Avalanche│ │ Avalanche (sAVAX)│                           │
│  └──────────┘ └──────────────────┘                           │
│         │            │          │            │                │
│         └────────────▼──────────▼────────────┘                │
│                 BundleBuilder (shared)                         │
│           Prepares unsigned transaction bundles                │
└─────────────────────────┬───────────────────────────────────┘
                          │ On-chain
┌─────────────────────────▼───────────────────────────────────┐
│      PanoramaExecutor (deployed per chain)                    │
│   execute(protocolId, action, transfers, deadline, data)      │
│                                                               │
│   Creates per-user adapter clones — positions fully isolated  │
│          │                                                    │
│   ┌──────▼────────────────────────────────────────────┐      │
│   │ User Clone A │ User Clone B │ ... │ User Clone N  │      │
│   │ (isolated)   │ (isolated)   │     │ (isolated)    │      │
│   └───────────────────────────────────────────────────┘      │
└─────────────────────────────────────────────────────────────┘
```

### How It Works

1. **User** requests a DeFi action (e.g., "swap 1 WETH for USDC" or "supply 100 USDC to Benqi")
2. **Backend** queries on-chain state (allowances, reserves, balances, rates)
3. **Backend** builds an ordered `TransactionBundle` via `BundleBuilder`
4. **Frontend** receives the bundle and signs each transaction with the user's wallet
5. **Executor** creates or reuses a **per-user clone** for the target protocol
6. The clone interacts with protocol contracts — each user's positions and balances are fully isolated

> **The backend never holds private keys.** It only prepares unsigned calldata.

### Protocol-Neutral Executor

The executor has a single entry point with **zero knowledge** of specific actions:

```solidity
function execute(
    bytes32 protocolId,     // e.g. keccak256("aerodrome"), keccak256("benqi")
    bytes4 action,          // Solidity function selector
    Transfer[] transfers,   // tokens to pull into the user's adapter
    uint256 deadline,
    bytes data              // ABI-encoded adapter function parameters
) external payable returns (bytes memory)
```

It only:
1. Creates/retrieves the user's adapter clone for the given `protocolId`
2. Pulls ERC-20 tokens from the user into the clone
3. Calls `clone.call(action ++ data)` — raw dispatch to the adapter

This means:
- **New protocol** → deploy adapter, call `registerAdapter()`. Zero executor changes.
- **New action** → implement on the adapter. Zero executor changes.
- **The executor never needs redeployment** as the protocol ecosystem grows.

---

## Deployed Contracts

### Base Mainnet (8453)

| Contract | Address |
|---|---|
| PanoramaExecutor | [`0x82b000512A19f7B762A23033aEA5AE00aBD0D2bC`](https://basescan.org/address/0x82b000512A19f7B762A23033aEA5AE00aBD0D2bC) |
| AerodromeAdapter | [`0x187e499afB2DE75836800ad19147e0cFcd2Dc715`](https://basescan.org/address/0x187e499afB2DE75836800ad19147e0cFcd2Dc715) |
| DCAVault | [`0x155eC4256cC6f11f3d4C21Af28a2a1CC31f730d1`](https://basescan.org/address/0x155eC4256cC6f11f3d4C21Af28a2a1CC31f730d1) |

### Avalanche C-Chain (43114)

| Contract | Description |
|---|---|
| PanoramaSwap | Trader Joe V1 swap router |
| PanoramaLend | Benqi Finance lending |
| TraderJoeAdapter | V2 swap adapter |
| BenqiLendAdapter | V2 lending adapter |
| SAVAXAdapter | V2 liquid staking adapter |

Deploy script: `script/avax/DeployAvaxV2.s.sol`

---

## Project Structure

```
execution-layer/
├── contracts/
│   ├── aerodrome/                          # Base chain
│   │   ├── core/
│   │   │   ├── PanoramaExecutor.sol        # Protocol-neutral executor
│   │   │   ├── PanoramaExecutorV2.sol      # Upgradeable executor (BeaconProxy)
│   │   │   └── DCAVault.sol                # Automated DCA orders
│   │   ├── adapters/
│   │   │   ├── AerodromeAdapter.sol        # Swap, liquidity, staking
│   │   │   └── AerodromeAdapterV2.sol      # Upgradeable version
│   │   ├── interfaces/
│   │   └── libraries/
│   │
│   └── avax/                               # Avalanche chain
│       ├── adapters/
│       │   ├── TraderJoeAdapter.sol         # Swap (Trader Joe V1)
│       │   ├── BenqiLendAdapter.sol         # Lending (Benqi Finance)
│       │   └── SAVAXAdapter.sol             # Liquid staking (sAVAX)
│       ├── core/
│       │   └── PanoramaSwap.sol             # Swap router wrapper
│       ├── lending/
│       │   └── PanoramaLend.sol             # Lending wrapper
│       └── interfaces/
│
├── backend/
│   └── src/
│       ├── config/
│       │   ├── chains.ts                   # Base + Avalanche chain configs
│       │   └── protocols.ts                # Protocol registry
│       ├── shared/
│       │   ├── bundle-builder.ts           # BundleBuilder + ADAPTER_SELECTORS
│       │   ├── aerodrome-swap.ts           # Base swap bundle builder
│       │   ├── aerodrome-add-liquidity.ts  # Base liquidity bundle builder
│       │   └── services/
│       │       ├── aerodrome.service.ts    # Base on-chain reads
│       │       └── avax.service.ts         # Avalanche on-chain reads
│       └── modules/
│           ├── swap/                       # Base — Aerodrome swap
│           ├── liquid-staking/             # Base — Gauge staking
│           ├── dca/                        # Base — DCA automation
│           ├── avax-swap/                  # Avalanche — Trader Joe swap
│           └── avax-lending/               # Avalanche — Benqi lending
│
├── script/
│   ├── Deploy.s.sol                        # Base deployment
│   ├── DeployV2.s.sol                      # Base V2 deployment
│   ├── DeployDCAVault.s.sol                # DCA vault deployment
│   └── avax/
│       ├── DeployAvax.s.sol                # Avalanche deployment
│       └── DeployAvaxV2.s.sol              # Avalanche V2 deployment
│
└── test/
    ├── PanoramaExecutor.t.sol
    ├── DCAVault.t.sol
    ├── mocks/
    ├── fork/
    └── avax/
```

---

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) >= 18
- [Foundry](https://book.getfoundry.sh/)

### Install

```bash
forge install
cd backend && npm install
```

### Environment

```env
# backend/.env
PORT=3010
BASE_RPC_URL=https://mainnet.base.org
AVAX_RPC_URL=https://api.avax.network/ext/bc/C/rpc
EXECUTOR_ADDRESS=0x82b000512A19f7B762A23033aEA5AE00aBD0D2bC
AERODROME_ADAPTER_ADDRESS=0x187e499afB2DE75836800ad19147e0cFcd2Dc715
DCA_VAULT_ADDRESS=0x155eC4256cC6f11f3d4C21Af28a2a1CC31f730d1
```

### Run

```bash
# Docker (recommended)
docker compose up -d --build

# Or locally
cd backend && npm run dev
```

### Tests

```bash
# Solidity unit tests (no RPC needed)
forge test -vv --no-match-path "test/fork/*"

# Fork tests (requires RPC)
BASE_RPC_URL=https://mainnet.base.org forge test --match-path "test/fork/*" -vvv

# Backend (Vitest)
cd backend && npm test
```

---

## API Endpoints

### Base — Swap (`/swap`)

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/swap/pairs` | Available trading pairs with on-chain reserves |
| `POST` | `/swap/quote` | Price quote with exchange rate |
| `POST` | `/swap/prepare` | Transaction bundle: [approve] → swap |

### Base — Liquid Staking (`/staking`)

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/staking/pools` | Pools with live on-chain data |
| `GET` | `/staking/protocol-info` | APR and TVL per pool |
| `GET` | `/staking/position/:address` | User staked positions and pending rewards |
| `GET` | `/staking/portfolio/:address` | Full portfolio with wallet balances |
| `POST` | `/staking/prepare-enter` | Bundle: approve → addLiquidity → stake |
| `POST` | `/staking/prepare-exit` | Bundle: unstake → removeLiquidity |
| `POST` | `/staking/prepare-claim` | Claim AERO rewards |

### Base — DCA (`/dca`)

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/dca/prepare-create` | Bundle: approve → createOrder |
| `POST` | `/dca/prepare-cancel` | Bundle: cancel → withdraw remaining |
| `GET` | `/dca/orders/:address` | User's DCA orders |
| `GET` | `/dca/executable` | Orders ready to execute (keeper) |

### Avalanche — Swap (`/avax/swap`)

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/avax/swap/pairs` | Supported Trader Joe pairs |
| `POST` | `/avax/swap/quote` | Price quote with path routing |
| `POST` | `/avax/swap/prepare` | Bundle: [approve] → swap |

### Avalanche — Lending (`/avax/lending`)

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/avax/lending/markets` | Benqi markets with live supply/borrow rates |
| `GET` | `/avax/lending/position/:address` | User positions (supplied, borrowed) |
| `POST` | `/avax/lending/prepare-supply` | Bundle: [approve] → supply |
| `POST` | `/avax/lending/prepare-redeem` | Bundle: redeem |
| `POST` | `/avax/lending/prepare-borrow` | Bundle: borrow |
| `POST` | `/avax/lending/prepare-repay` | Bundle: [approve] → repay |

---

## Adapters

### Base — AerodromeAdapter

Aerodrome Finance integration (Router2 + Voter + Gauges).

| Action | Function Signature |
|---|---|
| Swap | `swap(address,address,uint256,uint256,address,bool)` |
| Add Liquidity | `addLiquidity(address,address,bool,uint256,uint256,uint256,uint256,address)` |
| Remove Liquidity | `removeLiquidity(address,address,bool,uint256,uint256,uint256,address,address)` |
| Stake LP | `stake(address,uint256,address)` |
| Unstake LP | `unstake(address,uint256,address,address)` |
| Claim Rewards | `claimRewards(address,address,address)` |

Key addresses:
```
Aerodrome Router2:  0xcF77a3Ba9A5CA399B7c97c74d54e5b1Beb874E43
Aerodrome Voter:    0x16613524e02ad97eDfeF371bC883F2F5d6C480A5
```

### Avalanche — TraderJoeAdapter

Trader Joe V1 swap with automatic routing through WAVAX when needed.

| Action | Function Signature |
|---|---|
| Swap | `swap(address,address,uint256,uint256,address)` |
| Multi-hop Swap | `swapWithPath(uint256,uint256,address[],address)` |
| Quote (view) | `getAmountsOut(uint256,address[])` |

Key addresses:
```
Trader Joe Router: 0x60aE616a2155Ee3d9A68541Ba4544862310933d4
WAVAX:             0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7
```

### Avalanche — BenqiLendAdapter

Per-user isolated lending positions on Benqi Finance. Supports both ERC-20 tokens and native AVAX.

| Action | Function Signature |
|---|---|
| Supply ERC-20 | `supply(address,uint256,address)` |
| Redeem ERC-20 | `redeem(address,uint256,address)` |
| Borrow ERC-20 | `borrow(address,uint256,address)` |
| Repay ERC-20 | `repay(address,uint256)` |
| Supply AVAX | `supplyAVAX(address)` payable |
| Redeem AVAX | `redeemAVAX(uint256,address)` |
| Borrow AVAX | `borrowAVAX(uint256,address)` |
| Repay AVAX | `repayAVAX()` payable |
| Enter Markets | `enterMarkets(address[])` |
| Exit Market | `exitMarket(address)` |

Key addresses:
```
Benqi Comptroller: 0x486Af39519B4Dc9a7fCcd318217352830E8AD9b4
qiAVAX:            0x5C0401e81Bc07Ca70fAD469b451682c0d747Ef1c
qiUSDC:            0xBEb5d47A3f720Ec0a390d04b4d41ED7d9688bC7F
qiUSDT:            0xc9e5999b8e75C3fEB117F6f73E664b9f3C8ca65C
qiETH:             0x334AD834Cd4481BB02d09615E7c11a00579A7909
```

### Avalanche — SAVAXAdapter

BENQI liquid staking (sAVAX) with per-user unlock request tracking.

| Action | Function Signature |
|---|---|
| Stake AVAX | `stake(address)` payable |
| Request Unlock | `requestUnlock(uint256)` |
| Redeem | `redeem(uint256,address)` |
| Preview Stake (view) | `previewStake(uint256)` |
| Preview Redeem (view) | `previewRedeem(uint256)` |
| Exchange Rate (view) | `exchangeRate()` |

Key addresses:
```
sAVAX: 0x2b2C81e08f1Af8835a78Bb2A90AE924ACE0eA4bE
```

---

## Adding a New Protocol

### 1. Write the adapter

```solidity
contract MyAdapter {
    address public executor;

    modifier onlyExecutor() {
        require(msg.sender == executor, "only executor");
        _;
    }

    function myAction(...) external onlyExecutor returns (...) {
        // protocol logic
    }

    receive() external payable {}
}
```

### 2. Deploy and register

```solidity
MyAdapter adapter = new MyAdapter();
executor.registerAdapter(keccak256("myprotocol"), address(adapter));
```

### 3. Add backend module

```typescript
registerProtocol("myprotocol", {
  protocolId: "myprotocol",
  chain: "base", // or "avalanche"
  contracts: { router: "0x..." },
});
```

No changes needed to the executor or BundleBuilder.

---

## Tech Stack

| Component | Technology |
|---|---|
| Smart Contracts | Solidity 0.8.24, Foundry, OpenZeppelin v5 |
| Backend | Node.js, Express, ethers.js v6, TypeScript |
| Testing | Foundry (Solidity), Vitest (TypeScript) |
| Chains | Base (8453), Avalanche C-Chain (43114) |
| Protocols | Aerodrome Finance, Trader Joe, Benqi Finance, BENQI sAVAX |
