# CLAUDE.md — Panorama Execution Layer

Guidelines for working with this codebase.

## Language

Always respond in **Brazilian Portuguese (pt-BR)**.

## Leitura obrigatória

Sempre ler o `README.md` na raiz do projeto antes de iniciar qualquer tarefa. Ele contém a visão geral da arquitetura, estrutura de arquivos, endpoints da API e guias de expansão que complementam as regras deste arquivo.

## Repository layout

```
execution-layer/
├── contracts/        Solidity — PanoramaExecutor, AerodromeAdapter, DCAVault
├── backend/          Node.js/TypeScript — Express API
├── test/             Foundry tests (unit + fork)
└── frontend/         Demo UI (plain HTML/JS)
```

## Test commands

```bash
# Solidity unit tests (sem RPC)
forge test -vv --no-match-path "test/fork/*"

# Solidity fork tests (precisa de BASE_RPC_URL)
BASE_RPC_URL=https://mainnet.base.org forge test --match-path "test/fork/*" -vvv

# Backend (Vitest)
cd backend && npm test
```

**Sempre rodar os dois suites após qualquer mudança.** Não fazer commit com testes falhando.

## Arquitetura central

### PanoramaExecutor — entry point único

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
1. Cria/recupera o clone EIP-1167 do usuário para `protocolId`
2. Puxa tokens do usuário para o clone via `transfers`
3. Faz `adapter.call(action ++ data)` — dispatch cego

**Nunca adicionar lógica de ação no executor.** Toda lógica vai no adapter.

### ADAPTER_SELECTORS — selectors Solidity completos

Os selectors em `backend/src/shared/bundle-builder.ts` usam a **assinatura completa**:

```typescript
ethers.id("swap(address,address,uint256,uint256,address,bool)").slice(0, 10)
```

Não usar `ethers.id("swap")` — isso é keccak256 do nome sem tipos e não corresponde ao selector Solidity.

### BundleBuilder — único ponto de montagem de bundles

```typescript
new BundleBuilder(chainId)
  .addApproveIfNeeded(token, spender, currentAllowance, required, "Approve X")
  .addExecute(protocolId, ADAPTER_SELECTORS.SWAP, transfers, deadline, adapterData, 0n, executor, "Swap")
  .build("summary")
```

**Nunca construir `PreparedTransaction` manualmente fora do BundleBuilder.**

### Módulos de serviço — forma pública canônica

Cada produto tem seu módulo em `backend/src/modules/<nome>/`:
- `usecases/` — lógica de negócio, monta bundles
- `controllers/` — parsing de request/response HTTP
- `routes/` — registra Express routes

Os módulos de produto (`/swap`, `/staking`, `/dca`) são a **fonte de verdade canônica**. O `usecases/swap-provider.usecase.ts` é apenas um adapter de mapeamento de shape para o Liquid Swap Service — ele **delega** para os usecases de `/swap`, não reimplementa lógica.

A lógica on-chain fica toda em `shared/services/aerodrome.service.ts` (singleton). Os usecases chamam o service, nunca fazem chamadas RPC diretas.

### Helpers de bundle compartilhados

Operações que requerem múltiplos steps devem usar os helpers em `shared/`:

| Helper | Uso |
|--------|-----|
| `buildAerodromeSwapBundle(params)` | approve (se necessário) → swap |
| `buildAerodromeAddLiquidityBundle(params)` | approve A/B → addLiquidity → approve LP → stake |

**Nunca construir esses flows inline nos usecases.** Adicionar novo helper em `shared/` ao criar um novo flow com 3+ steps.

### Quote com `stable: "auto"`

`executeGetSwapQuote` em `modules/swap/usecases/get-quote.usecase.ts` aceita `stable: "auto"`. Quando passado, tenta volatile e stable, ignora silenciosamente pools inexistentes e retorna o melhor output com `stable: boolean` resolvido. Usar `"auto"` sempre que o caller não souber qual pool usar.

### Protocol registry

Para adicionar protocolo novo:
```typescript
// backend/src/config/protocols.ts
registerProtocol("velodrome", { protocolId: "velodrome", ... });
```

```solidity
// on-chain
executor.registerAdapter(keccak256("velodrome"), velodromeAdapterAddress);
```

Zero mudanças no executor ou no BundleBuilder.

## Encoding de adapterData

O `data` passado ao `execute()` deve ser **exatamente** o `abi.encode` dos parâmetros tipados da função do adapter, **sem o selector**:

```typescript
// swap(address tokenIn, address tokenOut, uint256 amountIn, uint256 amountOutMin, address recipient, bool stable)
const adapterData = ethers.AbiCoder.defaultAbiCoder().encode(
  ["address", "address", "uint256", "uint256", "address", "bool"],
  [tokenIn, tokenOut, amountIn, amountOutMin, recipient, stable]
);
```

O executor concatena `action ++ data` antes de chamar o adapter — o adapter recebe isso como calldata completa com selector.

## Mocking em testes Vitest

`vi.mock()` é hoisted pelo Vitest. Variáveis referenciadas dentro do factory devem ser declaradas com `vi.hoisted()`:

```typescript
const { mockFn } = vi.hoisted(() => ({ mockFn: vi.fn() }));
vi.mock("../../some/module", () => ({ myFunc: mockFn }));
```

**Nunca usar `require()` dinâmico dentro de `it()` ou `beforeEach()` para acessar módulos mockados** — o path resolver não encontra o mock correto nesse contexto.

## Contratos — regras

- `PanoramaExecutor.sol`: nunca adicionar funções de ação específica. O `execute()` genérico é o único entry point.
- `IProtocolAdapter.sol`: assinaturas com parâmetros tipados planos (sem `bytes extraData`). O backend encode exatamente esses tipos.
- `DCAVault.sol`: usa `IPanoramaExecutor` interface — importar de `interfaces/IPanoramaExecutor.sol`.
- Fork tests compilam mesmo com `--no-match-path`. Manter sincronizados com a API atual.

## Chains suportadas

| Chain | Status | Protocolo |
|-------|--------|-----------|
| Base (8453) | Ativo | Aerodrome Finance |
| Optimism | Planejado | Velodrome Finance |
| Arbitrum | Planejado | TBD |

O backend usa `getChainConfig("base")` de `config/chains.ts`.
