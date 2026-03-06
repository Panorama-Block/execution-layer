# Multi-Chain Strategy

## Principle

Build once, deploy everywhere. The core contract architecture is chain-agnostic. Protocol adapters are the only chain-specific components.

## Chain-Agnostic Core

These contracts deploy identically to any EVM chain:
- **PanoramaExecutor.sol** - No chain-specific logic. Pure routing and delegation.
- **IProtocolAdapter.sol** - Generic interface. No chain references.
- **SafeTransferLib.sol** - Standard ERC20 utilities.

## Per-Chain Adapters

Each chain gets protocol-specific adapters that implement IProtocolAdapter:

| Chain | Adapter | Protocol | Status |
|-------|---------|----------|--------|
| Base (8453) | AerodromeAdapter | Aerodrome Finance | Active |
| Avalanche (43114) | TraderJoeAdapter | Trader Joe | Planned |
| Avalanche (43114) | BenqiAdapter | Benqi | Planned |
| Arbitrum (42161) | CamelotAdapter | Camelot | Planned |
| Optimism (10) | VelodromeAdapter | Velodrome | Planned |

## Deployment Process

For each new chain:

1. **Deploy PanoramaExecutor** - Same bytecode, new address
2. **Deploy protocol adapter(s)** - Chain-specific, wraps local protocols
3. **Register adapters** - Call executor.registerAdapter(protocolId, adapterAddress)
4. **Update backend config** - Add chain entry in chains.ts with RPC URL and contract addresses

### Deployment Script Pattern

```bash
# Same Deploy.s.sol, different RPC URL
forge script script/Deploy.s.sol --rpc-url $AVALANCHE_RPC_URL --broadcast --verify
```

The deployment script deploys executor + adapter and registers them in one transaction.

## Backend Configuration

```typescript
// backend/src/config/chains.ts
export const CHAIN_CONFIG = {
  8453: {
    name: "Base",
    rpcUrl: process.env.BASE_RPC_URL,
    executor: "0x...",
    protocols: {
      aerodrome: {
        router: "0xcF77...",
        factory: "0x420D...",
        voter: "0x1661...",
        adapter: "0x...",
      }
    }
  },
  43114: {
    name: "Avalanche",
    rpcUrl: process.env.AVALANCHE_RPC_URL,
    executor: "0x...",
    protocols: {
      traderjoe: {
        router: "0x...",
        adapter: "0x...",
      }
    }
  }
};
```

## Frontend Integration

The frontend is already multi-chain (supports 8+ chains via Thirdweb). Adding a new chain requires:
- Chain config entry with executor address
- Token list for the chain (already exists in token-registry.json)
- Chain switching via `useSwitchActiveWalletChain`

No frontend code changes needed per chain.

## Agent Integration

The agent layer is already multi-chain (swap agent supports base, avalanche, etc. in registry.json). For the execution agent:
- Add chain to supported_chains in config.py
- Add tokens to supported_tokens per chain
- Same intent collection flow, different chain parameter

## Deployment Timeline

1. **Now:** Base (Aerodrome) - hackathon priority
2. **Next:** Avalanche (Trader Joe, Benqi) - 10k user activation
3. **Future:** Arbitrum (Camelot), Optimism (Velodrome)

## Writing a New Adapter

To add a protocol on a new chain:

1. Create `contracts/adapters/NewProtocolAdapter.sol`
2. Implement all IProtocolAdapter functions
3. Map protocol-specific calls (router interface, pool types, staking mechanics)
4. Write tests against protocol's testnet or mainnet fork
5. Deploy and register

The adapter contract size is typically 100-200 lines, focused purely on protocol translation.
