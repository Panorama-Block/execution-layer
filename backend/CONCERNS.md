# Preocupacoes e Melhorias Futuras

## 1. Isolamento de Fundos no Adapter (CRITICO para producao)

**Status:** Aceitavel para hackathon, bloqueante para producao multi-usuario.

### Problema

O contrato adapter (`0xf919A01510591f38407AA4BBE5711646DB6819e3`) mantém uma unica posicao compartilhada em cada gauge do Aerodrome. Nao existe nenhum mapeamento on-chain para rastrear qual parte pertence a qual usuario.

Atualmente, qualquer usuario que consulte sua posicao via `/staking/position/:address` vera o saldo total do adapter como se fosse dele.

### Por que funciona no hackathon

- O `owner` do executor (`0x79D671250f75631ca199d0Fa22b0071052214172`) e a carteira do desenvolvedor.
- Apenas o owner pode chamar `executeUnstake`/`executeStake`.
- Na pratica, ha apenas um usuario, entao toda a posicao do adapter e dele.

### Solucoes para producao

1. **Contabilidade per-user on-chain** — Adicionar `mapping(address => mapping(address => uint256)) userStakes` no adapter/executor que registra quanto cada usuario depositou por pool.

2. **Um adapter por usuario (recomendado)** — Fazer deploy de um proxy minimo (clone) do adapter para cada usuario, isolando as posicoes naturalmente. Requer apenas uma factory que faz deploy de clones. Mudanca minima nos contratos existentes.

3. **Ledger off-chain** — Rastrear depositos/saques num banco de dados e calcular a parte de cada usuario proporcionalmente. Menos seguro, pois depende de dados off-chain.

### Contratos relevantes

- Executor: `0x79D671250f75631ca199d0Fa22b0071052214172`
- Adapter: `0xf919A01510591f38407AA4BBE5711646DB6819e3`
- O adapter tem: `stake()`, `unstake()`, `executor()` — nao tem `claimRewards` nem mapeamento de saldo por usuario.
- O gauge exige `msg.sender == account` para `getReward()`, entao so o adapter pode clamar suas proprias rewards.

### Workaround atual para claim de rewards

Como o executor nao possui funcao `claimRewards` e o gauge exige que o `msg.sender` seja o proprio staker, o backend usa um ciclo de unstake + restake completo para acionar a contabilidade de rewards do gauge.
