# Preocupacoes e Melhorias Futuras

## 1. Isolamento de Fundos no Adapter

**Status:** RESOLVIDO — implementado via EIP-1167 per-user clones.

### Solucao implementada

Cada usuario recebe seu proprio clone do adapter (EIP-1167 minimal proxy) na primeira interacao com o executor. O clone e criado deterministicamente via `Clones.cloneDeterministic(implementation, salt)` onde `salt = keccak256(user, protocolId)`.

- **Posicoes isoladas**: cada clone tem seu proprio storage, entao depositos em gauges, LP tokens e rewards sao separados por usuario.
- **Enderecos deterministicos**: o backend pode prever o endereco do clone via `predictUserAdapter(protocolId, user)` sem estado on-chain.
- **Custo**: ~45k gas na primeira interacao (criacao do clone). Interacoes subsequentes usam o clone existente.

### Contratos relevantes

- Executor: `0x82b000512A19f7B762A23033aEA5AE00aBD0D2bC`
- Adapter (implementation): `0x187e499afB2DE75836800ad19147e0cFcd2Dc715`
- O executor tem: `registerAdapter()`, `adapterImplementations()`, `getUserAdapter()`, `predictUserAdapter()`, `userAdapters()`
- O adapter tem: `swap()`, `addLiquidity()`, `removeLiquidity()`, `stake()`, `unstake()`, `claimRewards()`, `executor()`
- O executor tem `executeClaimRewards()` que chama `adapter.claimRewards()`, que faz `gauge.getReward(adapter)` e envia AERO para o usuario.
