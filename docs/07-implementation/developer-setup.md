# Developer Setup

## Prerequisites

- [Foundry](https://book.getfoundry.sh/getting-started/installation) (forge, cast, anvil)
- Node.js 18+
- Python 3.11+
- Git

## Smart Contracts

```bash
cd panoramablock-execution-layer

# Install Foundry dependencies
forge install foundry-rs/forge-std
forge install OpenZeppelin/openzeppelin-contracts

# Build
forge build

# Test (unit tests with mocks)
forge test

# Test (fork tests against Base mainnet)
forge test --fork-url $BASE_RPC_URL

# Deploy to Base mainnet
cp .env.example .env
# Fill in PRIVATE_KEY and BASE_RPC_URL
source .env
forge script script/Deploy.s.sol --rpc-url $BASE_RPC_URL --broadcast --verify
```

## Backend (execution-service)

```bash
cd panoramablock-execution-layer/backend

# Install dependencies
npm install

# Configure
cp .env.example .env
# Fill in BASE_RPC_URL, EXECUTOR_ADDRESS, etc.

# Run in development
npm run dev  # Starts on port 3010

# Build
npm run build

# Run in production
npm start
```

## Agents (Zico)

```bash
cd zico_agents/new_zico

# Create virtual environment
python -m venv .venv
source .venv/bin/activate

# Install dependencies
pip install -r requirements.txt

# Configure
cp .env.example .env
# Fill in GOOGLE_API_KEY, etc.

# Run
python -m src.app
```

## Frontend (MiniApp)

```bash
cd telegram/apps/miniapp

# Install dependencies
npm install

# Configure
cp .env.local.example .env.local
# Add NEXT_PUBLIC_EXECUTION_API_BASE=http://localhost:3010

# Run in development
npm run dev
```

## Local E2E Testing

Run all services simultaneously:

```
Terminal 1: cd panoramablock-execution-layer/backend && npm run dev
Terminal 2: cd telegram/apps/miniapp && npm run dev
Terminal 3: cd zico_agents/new_zico && python -m src.app
Terminal 4: cd telegram/apps/gateway && npm run dev
```

Test flow: send message to Telegram bot -> verify agent response -> open MiniApp -> execute swap.

## Environment Variables

### Contracts (.env)
```
BASE_RPC_URL=https://mainnet.base.org
PRIVATE_KEY=0x...
BASESCAN_API_KEY=...
```

### Backend (.env)
```
PORT=3010
BASE_RPC_URL=https://mainnet.base.org
EXECUTOR_ADDRESS=0x...
AERODROME_ADAPTER_ADDRESS=0x...
```

### Frontend (.env.local)
```
NEXT_PUBLIC_EXECUTION_API_BASE=http://localhost:3010
```

## Note on Testnet

Aerodrome does not exist on Base Sepolia. Options:
- Test against Base mainnet fork: `forge test --fork-url $BASE_RPC_URL`
- Test on Base mainnet with small amounts (0.001 ETH)
- Deploy mock contracts on Sepolia for unit testing
