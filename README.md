# PanoramaBlock Execution Layer

On-chain execution infrastructure for PanoramaBlock. Deploys reusable smart contracts that route DeFi operations through protocol adapters.

## Architecture

```
User (Telegram MiniApp)
  |
  v
Zico Agent (execution_agent)
  |
  v
Execution Service (backend, port 3010)
  |
  v
PanoramaExecutor.sol (on-chain)
  |
  v
Protocol Adapters (AerodromeAdapter, etc.)
  |
  v
DeFi Protocols (Aerodrome, Moonwell, etc.)
```

## Contracts

| Contract | Description |
|----------|-------------|
| `PanoramaExecutor.sol` | Core entry point. Routes operations to registered protocol adapters. |
| `IProtocolAdapter.sol` | Generic interface all adapters implement. |
| `AerodromeAdapter.sol` | Aerodrome Finance adapter (swaps, liquidity, LP staking). |
| `SafeTransferLib.sol` | Safe ERC20 transfer utilities. |

## Supported Chains

| Chain | Status | Primary Protocol |
|-------|--------|-----------------|
| Base | Active | Aerodrome Finance |
| Avalanche | Planned | TBD |
| Arbitrum | Planned | TBD |

## Setup

### Prerequisites

- [Foundry](https://book.getfoundry.sh/getting-started/installation)
- Node.js 18+ (for backend service)

### Install Dependencies

```bash
forge install foundry-rs/forge-std
forge install OpenZeppelin/openzeppelin-contracts
```

### Build

```bash
forge build
```

### Test

```bash
# Unit tests
forge test

# Fork tests against Base mainnet
forge test --fork-url $BASE_RPC_URL
```

### Deploy

```bash
# Copy env file and fill in values
cp .env.example .env

# Deploy to Base mainnet
source .env
forge script script/Deploy.s.sol --rpc-url $BASE_RPC_URL --broadcast --verify

# Deploy to Base Sepolia (testnet)
forge script script/DeployTestnet.s.sol --rpc-url $BASE_SEPOLIA_RPC_URL --broadcast
```

## Backend Service

The execution service prepares transaction calldata for the frontend to sign.

```bash
cd backend
npm install
npm run dev   # Starts on port 3010
```

See [docs/](docs/) for full documentation.

## Repository Structure

```
contracts/          Smart contract source code
  core/             Core executor contract
  interfaces/       Protocol and adapter interfaces
  adapters/         Protocol-specific adapter implementations
  libraries/        Shared utility libraries
test/               Foundry tests
script/             Deployment scripts
backend/            Execution service (Node.js/TypeScript)
docs/               Documentation, diagrams, specs
```

## Documentation

Full documentation is available in [`docs/`](docs/), organized into:

- **00-overview/** - Platform overview and philosophy
- **01-user-flows/** - End-to-end user flow descriptions
- **02-system-architecture/** - Technical architecture docs
- **03-smart-contracts/** - Contract design and integration specs
- **04-backend-integration/** - Backend service integration
- **05-sequence-diagrams/** - Sequence diagrams with Mermaid
- **06-business/** - Product vision and strategy
- **07-implementation/** - Roadmap and developer setup
- **08-tasks/** - Task breakdowns
- **09-strategy-agent/** - Strategy agent documentation
- **10-onboarding/** - Onboarding specs
- **diagrams/** - Mermaid diagram source files
# execution-layer
