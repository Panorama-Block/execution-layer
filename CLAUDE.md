# CLAUDE.md — Panorama Execution Layer

Guidelines for working with this codebase.

## Language

Always respond in **Brazilian Portuguese (pt-BR)**.

## Leitura obrigatória

Sempre ler o `README.md` na raiz do projeto antes de iniciar qualquer tarefa.

## Repository layout

```
execution-layer/
├── contracts/
│   ├── aerodrome/       # Base: PanoramaExecutorV2, AerodromeAdapterV2, DCAVault
│   └── avax/            # Avalanche: TraderJoeAdapter, BenqiLendAdapter, SAVAXAdapter
├── backend/             # Node.js/TypeScript — Express API
├── script/              # Foundry deploy scripts (V1 + V2)
├── test/                # Foundry tests (unit + fork)
└── frontend/            # Demo UI
```

## Test commands

```bash
# Solidity unit tests (sem RPC)
forge test -vv --no-match-path "test/fork/*"

# Fork tests (precisa de BASE_RPC_URL)
BASE_RPC_URL=https://mainnet.base.org forge test --match-path "test/fork/*" -vvv

# Backend (Vitest)
cd backend && npm test
```

**Sempre rodar os dois suites após qualquer mudança.** Não fazer commit com testes falhando.

## Arquitetura central

### V2: BeaconProxy (upgradeable)

O sistema usa **BeaconProxy** (OpenZeppelin) ao invés de EIP-1167:
- Cada protocolo tem um `UpgradeableBeacon` que armazena o endereço da implementação
- Cada usuário recebe um `BeaconProxy` que delega para o beacon
- `beacon.upgradeTo(newImpl)` atualiza TODOS os usuários de uma vez
- Adapters usam `Initializable` + `__gap[50]` para storage stability

### PanoramaExecutorV2 — entry point único (ambas as chains)

```solidity
function execute(
    bytes32 protocolId,
    bytes4  action,              // bytes4(keccak256("nomeFuncao(tipos...)"))
    Transfer[] calldata transfers,
    uint256 deadline,
    bytes calldata data
) external payable returns (bytes memory result)
```

O executor **não conhece nenhuma ação específica**. Ele só:
1. Cria/recupera o BeaconProxy do usuário para `protocolId`
2. Puxa tokens do usuário para o proxy via `transfers`
3. Faz `proxy.call(action ++ data)` — dispatch cego

**Nunca adicionar lógica de ação no executor.** Toda lógica vai no adapter.

### Registro de protocolo

```solidity
// on-chain
executor.registerBeacon(keccak256("aerodrome"), beaconAddress, abi.encode(router, voter));
```

```typescript
// backend
registerProtocol("aerodrome", { protocolId: "aerodrome", chain: "base", ... });
```

Zero mudanças no executor ou no BundleBuilder.

### Inicialização de adapters

Todos os adapters V2 usam a mesma assinatura:

```solidity
function initializeFull(address _executor, bytes calldata _initArgs) external initializer
```

O executor armazena `protocolInitArgs` por protocolo e passa ao `initializeFull` na criação do proxy.

## ADAPTER_SELECTORS — selectors Solidity completos

Os selectors em `backend/src/shared/bundle-builder.ts` usam a **assinatura completa**:

```typescript
ethers.id("swap(address,address,uint256,uint256,address,bool)").slice(0, 10)
```

Não usar `ethers.id("swap")` — isso é keccak256 do nome sem tipos.

## BundleBuilder — único ponto de montagem de bundles

```typescript
new BundleBuilder(chainId)
  .addApproveIfNeeded(token, spender, currentAllowance, required, "Approve X")
  .addExecute(protocolId, ADAPTER_SELECTORS.SWAP, transfers, deadline, adapterData, 0n, executor, "Swap")
  .build("summary")
```

**Nunca construir `PreparedTransaction` manualmente fora do BundleBuilder.**

## Encoding de adapterData

O `data` passado ao `execute()` deve ser **exatamente** o `abi.encode` dos parâmetros tipados da função do adapter, **sem o selector**:

```typescript
const adapterData = ethers.AbiCoder.defaultAbiCoder().encode(
  ["address", "address", "uint256", "uint256", "address", "bool"],
  [tokenIn, tokenOut, amountIn, amountOutMin, recipient, stable]
);
```

## Módulos de serviço

Cada produto tem seu módulo em `backend/src/modules/<nome>/`:
- `usecases/` — lógica de negócio, monta bundles
- `controllers/` — parsing de request/response HTTP
- `routes/` — registra Express routes

### Base
- `modules/swap/` — Aerodrome swap
- `modules/liquid-staking/` — Aerodrome gauges
- `modules/dca/` — DCAVault automation

### Avalanche
- `modules/avax-swap/` — Trader Joe V1
- `modules/avax-lending/` — Benqi Finance

## Contratos — regras

- `PanoramaExecutorV2.sol`: nunca adicionar funções de ação específica. O `execute()` genérico é o único entry point.
- Adapters V2: sempre usar `Initializable`, `onlyExecutor`, `__gap[50]`, `receive() external payable`.
- `DCAVault.sol`: usa `IPanoramaExecutor` interface (mesma assinatura V1/V2).
- Storage layout: nunca reordenar variáveis de storage em upgrades. Apenas adicionar no final e reduzir `__gap`.

## Chains suportadas

| Chain | Status | Protocolos |
|-------|--------|-----------|
| Base (8453) | Ativo | Aerodrome Finance |
| Avalanche (43114) | Ativo | Trader Joe, Benqi, sAVAX |

O backend usa `getChainConfig("base")` ou `getChainConfig("avalanche")` de `config/chains.ts`.

## Mocking em testes Vitest

`vi.mock()` é hoisted pelo Vitest. Variáveis referenciadas dentro do factory devem ser declaradas com `vi.hoisted()`:

```typescript
const { mockFn } = vi.hoisted(() => ({ mockFn: vi.fn() }));
vi.mock("../../some/module", () => ({ myFunc: mockFn }));
```
