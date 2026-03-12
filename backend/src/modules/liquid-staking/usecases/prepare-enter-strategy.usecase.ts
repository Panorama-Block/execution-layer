import { getChainConfig } from "../../../config/chains";
import { getStakingPoolById } from "../config/staking-pools";
import { getContract } from "../../../providers/chain.provider";
import { ERC20_ABI } from "../../../utils/abi";
import { getDeadline, isNativeETH, applySlippage } from "../../../utils/encoding";
import { TransactionBundle } from "../../../types/transaction";
import { aerodromeService } from "../../../shared/services/aerodrome.service";
import { buildAerodromeAddLiquidityBundle } from "../../../shared/aerodrome-add-liquidity";

export interface PrepareEnterStrategyRequest {
  userAddress: string;
  poolId: string;
  amountA: string;
  amountB: string;
  slippageBps?: number;
  deadlineMinutes?: number;
}

export interface PrepareEnterStrategyResponse {
  bundle: TransactionBundle;
  metadata: {
    poolId: string;
    poolAddress: string;
    gaugeAddress: string;
    tokenA: { symbol: string; address: string; decimals: number };
    tokenB: { symbol: string; address: string; decimals: number };
    rewardToken: { symbol: string; address: string; decimals: number };
    stable: boolean;
    optimalAmountA: string;
    optimalAmountB: string;
    estimatedLiquidity: string;
    note: string;
  };
}

export async function executeEnterStrategy(
  req: PrepareEnterStrategyRequest
): Promise<PrepareEnterStrategyResponse> {
  const poolConfig = getStakingPoolById(req.poolId);
  if (!poolConfig) {
    throw new Error(`Staking pool not found: ${req.poolId}`);
  }

  const chain = getChainConfig("base");
  const executorAddress = chain.contracts.panoramaExecutor;
  if (!executorAddress) {
    throw new Error("Executor contract not configured");
  }

  let amountADesired = BigInt(req.amountA);
  let amountBDesired = BigInt(req.amountB);
  const slippageBps    = req.slippageBps ?? 100;
  const deadlineMinutes = req.deadlineMinutes ?? 20;

  console.log(`[ENTER] user=${req.userAddress}, pool=${req.poolId}`);
  console.log(`[ENTER] requested amountA=${amountADesired}, amountB=${amountBDesired}`);
  console.log(`[ENTER] executor=${executorAddress}`);

  // Cap amounts to user's actual on-chain balance to avoid TransferFromFailed.
  const [balA, balB] = await Promise.all([
    !isNativeETH(poolConfig.tokenA.address)
      ? aerodromeService.withRetry(async () => {
          const c = getContract(poolConfig.tokenA.address, ERC20_ABI, "base");
          return c.balanceOf(req.userAddress) as Promise<bigint>;
        }, 1, 250).catch(() => amountADesired)
      : Promise.resolve(amountADesired),
    !isNativeETH(poolConfig.tokenB.address)
      ? aerodromeService.withRetry(async () => {
          const c = getContract(poolConfig.tokenB.address, ERC20_ABI, "base");
          return c.balanceOf(req.userAddress) as Promise<bigint>;
        }, 1, 250).catch(() => amountBDesired)
      : Promise.resolve(amountBDesired),
  ]);

  console.log(`[ENTER] ${poolConfig.tokenA.symbol} balance=${balA}, desired=${amountADesired}, capped=${amountADesired > balA}`);
  console.log(`[ENTER] ${poolConfig.tokenB.symbol} balance=${balB}, desired=${amountBDesired}, capped=${amountBDesired > balB}`);
  if (amountADesired > balA) amountADesired = balA;
  if (amountBDesired > balB) amountBDesired = balB;

  if (amountADesired === 0n) throw new Error(`Insufficient ${poolConfig.tokenA.symbol} balance to enter this position`);
  if (amountBDesired === 0n) throw new Error(`Insufficient ${poolConfig.tokenB.symbol} balance to enter this position`);

  // Resolve pool and gauge addresses
  const { poolAddress, gaugeAddress } = await aerodromeService.resolvePoolAndGauge(poolConfig);

  // Query router for optimal amounts based on pool ratio
  const { optimalA, optimalB, estimatedLiquidity } = await aerodromeService.withRetry(() =>
    aerodromeService.quoteAddLiquidity(
      poolConfig.tokenA.address,
      poolConfig.tokenB.address,
      poolConfig.stable,
      amountADesired,
      amountBDesired
    )
  );

  if (estimatedLiquidity === 0n) {
    throw new Error(
      `Cannot add liquidity: the provided amounts are too small or too imbalanced. ` +
      `Try increasing both ${poolConfig.tokenA.symbol} and ${poolConfig.tokenB.symbol} amounts.`
    );
  }

  const amountAMin = applySlippage(optimalA, slippageBps);
  const amountBMin = applySlippage(optimalB, slippageBps);
  const deadline   = getDeadline(deadlineMinutes);

  const builder = await buildAerodromeAddLiquidityBundle({
    userAddress:        req.userAddress,
    tokenA:             poolConfig.tokenA,
    tokenB:             poolConfig.tokenB,
    poolAddress,
    gaugeAddress,
    stable:             poolConfig.stable,
    amountADesired,
    amountBDesired,
    amountAMin,
    amountBMin,
    estimatedLiquidity,
    slippageBps,
    deadline,
    executorAddress,
    chainId:            chain.chainId,
    poolName:           poolConfig.name,
  });

  return {
    bundle: builder.build(`Enter staking position: ${poolConfig.name}`),
    metadata: {
      poolId: poolConfig.id,
      poolAddress,
      gaugeAddress,
      tokenA: poolConfig.tokenA,
      tokenB: poolConfig.tokenB,
      rewardToken: poolConfig.rewardToken,
      stable: poolConfig.stable,
      optimalAmountA: optimalA.toString(),
      optimalAmountB: optimalB.toString(),
      estimatedLiquidity: estimatedLiquidity.toString(),
      note: "Amounts adjusted to pool ratio via quoteAddLiquidity.",
    },
  };
}
