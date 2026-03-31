import { getChainConfig } from "../../../config/chains";
import { getStakingPoolById } from "../config/staking-pools";
import { getContract } from "../../../providers/chain.provider";
import { ERC20_ABI } from "../../../utils/abi";
import { getDeadline, isNativeETH, applySlippage } from "../../../utils/encoding";
import { TransactionBundle } from "../../../types/transaction";
import { aerodromeService } from "../../../shared/services/aerodrome.service";
import { buildAerodromeAddLiquidityBundle } from "../../../shared/aerodrome-add-liquidity";
import { AppError } from "../../../shared/errorCodes";
import { logger } from "../../../shared/logger";

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

// Hard timeout for the entire prepare-enter flow.
// Prevents silent hangs from compounding when frontend retries are serialized.
const ENTER_TIMEOUT_MS = 15_000;

export async function executeEnterStrategy(
  req: PrepareEnterStrategyRequest
): Promise<PrepareEnterStrategyResponse> {
  return Promise.race([
    _executeEnterStrategyInner(req),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("prepare-enter timed out after 15s — RPC nodes may be congested")), ENTER_TIMEOUT_MS)
    ),
  ]);
}

async function _executeEnterStrategyInner(
  req: PrepareEnterStrategyRequest
): Promise<PrepareEnterStrategyResponse> {
  const t0 = Date.now();
  const poolConfig = getStakingPoolById(req.poolId);
  if (!poolConfig) {
    throw new AppError("POOL_NOT_FOUND", `Staking pool not found: ${req.poolId}`);
  }

  const chain = getChainConfig("base");
  const executorAddress = chain.contracts.panoramaExecutor;
  if (!executorAddress) {
    throw new AppError("EXECUTOR_NOT_CONFIGURED");
  }

  let amountADesired = BigInt(req.amountA);
  let amountBDesired = BigInt(req.amountB);
  const slippageBps    = req.slippageBps ?? 100;
  const deadlineMinutes = req.deadlineMinutes ?? 20;

  logger.info({ protocol: "aerodrome", user: req.userAddress, pool: req.poolId, amountA: amountADesired.toString(), amountB: amountBDesired.toString(), executor: executorAddress }, "Enter strategy request");

  // Cap amounts to user's actual on-chain balance to avoid TransferFromFailed.
  const [balA, balB] = await Promise.all([
    !isNativeETH(poolConfig.tokenA.address)
      ? aerodromeService.withTimeout(async () => {
          const c = getContract(poolConfig.tokenA.address, ERC20_ABI, "base");
          return c.balanceOf(req.userAddress) as Promise<bigint>;
        }).catch(() => amountADesired)
      : Promise.resolve(amountADesired),
    !isNativeETH(poolConfig.tokenB.address)
      ? aerodromeService.withTimeout(async () => {
          const c = getContract(poolConfig.tokenB.address, ERC20_ABI, "base");
          return c.balanceOf(req.userAddress) as Promise<bigint>;
        }).catch(() => amountBDesired)
      : Promise.resolve(amountBDesired),
  ]);

  logger.info({ protocol: "aerodrome", token: poolConfig.tokenA.symbol, balance: balA.toString(), desired: amountADesired.toString(), capped: amountADesired > balA, durationMs: Date.now() - t0 }, "Token A balance check");
  logger.info({ protocol: "aerodrome", token: poolConfig.tokenB.symbol, balance: balB.toString(), desired: amountBDesired.toString(), capped: amountBDesired > balB }, "Token B balance check");
  if (amountADesired > balA) amountADesired = balA;
  if (amountBDesired > balB) amountBDesired = balB;

  if (amountADesired === 0n) throw new AppError("INSUFFICIENT_BALANCE", `Insufficient ${poolConfig.tokenA.symbol} balance to enter this position`);
  if (amountBDesired === 0n) throw new AppError("INSUFFICIENT_BALANCE", `Insufficient ${poolConfig.tokenB.symbol} balance to enter this position`);

  // Resolve pool and gauge addresses (hardcoded in config — instant)
  const { poolAddress, gaugeAddress } = await aerodromeService.resolvePoolAndGauge(poolConfig);
  logger.info({ protocol: "aerodrome", poolAddress, gaugeAddress, durationMs: Date.now() - t0 }, "Pool and gauge resolved");

  // Query router for optimal amounts based on pool ratio.
  const { optimalA, optimalB, estimatedLiquidity } = await aerodromeService.quoteAddLiquidity(
    poolConfig.tokenA.address,
    poolConfig.tokenB.address,
    poolConfig.stable,
    amountADesired,
    amountBDesired
  );
  logger.info({ protocol: "aerodrome", optimalA: optimalA.toString(), optimalB: optimalB.toString(), estimatedLiquidity: estimatedLiquidity.toString(), durationMs: Date.now() - t0 }, "Liquidity quote obtained");

  if (estimatedLiquidity === 0n) {
    throw new AppError(
      "NO_LIQUIDITY",
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
  logger.info({ protocol: "aerodrome", durationMs: Date.now() - t0 }, "Bundle built");

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
