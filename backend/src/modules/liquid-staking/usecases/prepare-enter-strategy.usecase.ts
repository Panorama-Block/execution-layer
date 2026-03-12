import { ethers } from "ethers";
import { getChainConfig } from "../../../config/chains";
import { getStakingPoolById } from "../config/staking-pools";
import { getContract } from "../../../providers/chain.provider";
import { ERC20_ABI } from "../../../utils/abi";
import { encodeProtocolId, getDeadline, isNativeETH, applySlippage } from "../../../utils/encoding";
import { TransactionBundle } from "../../../types/transaction";
import { aerodromeService } from "../../../shared/services/aerodrome.service";
import { BundleBuilder, ADAPTER_SELECTORS } from "../../../shared/bundle-builder";

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
  const [balAResult, balBResult] = await Promise.all([
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

  const balA = balAResult;
  const balB = balBResult;
  console.log(`[ENTER] ${poolConfig.tokenA.symbol} balance=${balA}, desired=${amountADesired}, capped=${amountADesired > balA}`);
  console.log(`[ENTER] ${poolConfig.tokenB.symbol} balance=${balB}, desired=${amountBDesired}, capped=${amountBDesired > balB}`);
  if (amountADesired > balA) amountADesired = balA;
  if (amountBDesired > balB) amountBDesired = balB;

  // Resolve pool and gauge addresses (prefer canonical config, fallback on-chain).
  const { poolAddress, gaugeAddress } = await aerodromeService.resolvePoolAndGauge(poolConfig);

  if (amountADesired === 0n) {
    throw new Error(`Insufficient ${poolConfig.tokenA.symbol} balance to enter this position`);
  }
  if (amountBDesired === 0n) {
    throw new Error(`Insufficient ${poolConfig.tokenB.symbol} balance to enter this position`);
  }

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

  const protocolId  = encodeProtocolId("aerodrome");
  const deadline    = getDeadline(deadlineMinutes);
  const builder     = new BundleBuilder(chain.chainId);

  // Check allowances in parallel
  const [allowanceA, allowanceB, lpAllowance] = await Promise.all([
    !isNativeETH(poolConfig.tokenA.address)
      ? aerodromeService.withRetry(() =>
          aerodromeService.checkAllowance(
            poolConfig.tokenA.address, req.userAddress, executorAddress, amountADesired
          ), 1, 250
        ).catch((e) => {
          console.error(`[ENTER] allowance check ${poolConfig.tokenA.symbol} FAILED:`, e instanceof Error ? e.message : e);
          return { allowance: 0n, sufficient: false };
        })
      : Promise.resolve({ allowance: ethers.MaxUint256, sufficient: true }),
    !isNativeETH(poolConfig.tokenB.address)
      ? aerodromeService.withRetry(() =>
          aerodromeService.checkAllowance(
            poolConfig.tokenB.address, req.userAddress, executorAddress, amountBDesired
          ), 1, 250
        ).catch((e) => {
          console.error(`[ENTER] allowance check ${poolConfig.tokenB.symbol} FAILED:`, e instanceof Error ? e.message : e);
          return { allowance: 0n, sufficient: false };
        })
      : Promise.resolve({ allowance: ethers.MaxUint256, sufficient: true }),
    aerodromeService.withRetry(() =>
      aerodromeService.checkAllowance(poolAddress, req.userAddress, executorAddress, estimatedLiquidity), 1, 250
    ).catch((e) => {
      console.error(`[ENTER] LP allowance check FAILED:`, e instanceof Error ? e.message : e);
      return { allowance: 0n, sufficient: false };
    }),
  ]);

  // Step 1/2 - Approvals for tokenA/tokenB
  if (!isNativeETH(poolConfig.tokenA.address)) {
    console.log(`[ENTER] ${poolConfig.tokenA.symbol} allowance=${allowanceA.allowance.toString()}, needed=${amountADesired.toString()}, skip=${allowanceA.sufficient}`);
    builder.addApproveIfNeeded(
      poolConfig.tokenA.address, executorAddress, allowanceA.allowance, amountADesired,
      `Approve ${poolConfig.tokenA.symbol}`
    );
  }

  if (!isNativeETH(poolConfig.tokenB.address)) {
    console.log(`[ENTER] ${poolConfig.tokenB.symbol} allowance=${allowanceB.allowance.toString()}, needed=${amountBDesired.toString()}, skip=${allowanceB.sufficient}`);
    builder.addApproveIfNeeded(
      poolConfig.tokenB.address, executorAddress, allowanceB.allowance, amountBDesired,
      `Approve ${poolConfig.tokenB.symbol}`
    );
  }

  // Step 3 - Add Liquidity via PanoramaExecutor
  const addLiqData = ethers.AbiCoder.defaultAbiCoder().encode(
    ["address", "address", "bool", "uint256", "uint256", "uint256", "uint256", "address"],
    [poolConfig.tokenA.address, poolConfig.tokenB.address, poolConfig.stable,
     amountADesired, amountBDesired, amountAMin, amountBMin, req.userAddress]
  );

  let ethValue = 0n;
  if (isNativeETH(poolConfig.tokenA.address)) ethValue = amountADesired;
  else if (isNativeETH(poolConfig.tokenB.address)) ethValue = amountBDesired;

  const addLiqTransfers: Array<{ token: string; amount: bigint }> = [];
  if (!isNativeETH(poolConfig.tokenA.address)) addLiqTransfers.push({ token: poolConfig.tokenA.address, amount: amountADesired });
  if (!isNativeETH(poolConfig.tokenB.address)) addLiqTransfers.push({ token: poolConfig.tokenB.address, amount: amountBDesired });

  builder.addExecute(
    protocolId, ADAPTER_SELECTORS.ADD_LIQUIDITY,
    addLiqTransfers, deadline, addLiqData, ethValue,
    executorAddress, `Add liquidity to ${poolConfig.name}`
  );

  // Step 4 - Approve LP token to Executor (skip if already approved)
  console.log(`[ENTER] LP allowance=${lpAllowance.allowance.toString()}, needed=${estimatedLiquidity.toString()}, skip=${lpAllowance.sufficient}`);
  builder.addApproveIfNeeded(
    poolAddress, executorAddress, lpAllowance.allowance, estimatedLiquidity,
    "Approve LP token"
  );

  // Step 5 - Stake LP in Gauge via PanoramaExecutor
  const safeStakeAmount = applySlippage(estimatedLiquidity, slippageBps);
  const stakeData = ethers.AbiCoder.defaultAbiCoder().encode(
    ["address", "uint256", "address"],
    [poolAddress, safeStakeAmount, gaugeAddress]
  );

  builder.addExecute(
    protocolId, ADAPTER_SELECTORS.STAKE,
    [{ token: poolAddress, amount: safeStakeAmount }], deadline, stakeData, 0n,
    executorAddress, `Stake ${estimatedLiquidity.toString()} LP tokens in gauge`
  );

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
