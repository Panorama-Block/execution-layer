/**
 * Configurações do módulo dca.
 * Endereços do DCAVault são resolvidos em runtime via getChainConfig()
 * (ver src/config/chains.ts → contracts.dcaVault).
 *
 * Este arquivo centraliza parâmetros de validação e limites do módulo,
 * preparando o espaço para novos actionTypes (lending, staking, LP) que
 * serão adicionados nas próximas tasks.
 */

/** Número mínimo de swaps restantes para uma order DCA válida. */
export const DCA_MIN_REMAINING_SWAPS = 1;

/**
 * Intervalo mínimo entre execuções em segundos (1 hora).
 * Evita orders que consumam gas excessivamente em intervalos muito curtos.
 */
export const DCA_MIN_INTERVAL_SECONDS = 3600;
