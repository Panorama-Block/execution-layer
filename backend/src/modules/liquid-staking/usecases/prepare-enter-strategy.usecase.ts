import { ethers } from "ethers";
import { getChainConfig } from "../../../config/chains";
import { getProtocolConfig } from "../../../config/protocols";
import { getStakingPoolById } from "../config/staking-pools";
import { getPoolAddress } from "../../../providers/aerodrome.provider";
import { getGaugeForPool } from "../../../providers/gauge.provider";
import { getContract } from "../../../providers/chain.provider";
import { PANORAMA_EXECUTOR_ABI, AERODROME_ROUTER_ABI, ERC20_ABI } from "../../../utils/abi";
import { encodeProtocolId, getDeadline, isNativeETH, applySlippage } from "../../../utils/encoding";
import { PreparedTransaction, TransactionBundle } from "../../../types/transaction";

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

async function withRetry<T>(fn: () => Promise<T>, retries = 2, delayMs = 500): Promise<T> {
  for (let i = 0; i <= retries; i++) {
    try {
      return await fn();
    } catch (err) {
      if (i === retries) throw err;
      await new Promise((r) => setTimeout(r, delayMs * (i + 1)));
    }
  }
  throw new Error("Unreachable");
}

async function resolvePoolAndGaugeFromConfig(poolConfig: NonNullable<ReturnType<typeof getStakingPoolById>>): Promise<{ poolAddress: string; gaugeAddress: string }> {
  const poolAddress = poolConfig.poolAddress && poolConfig.poolAddress !== ethers.ZeroAddress
    ? poolConfig.poolAddress
    : await withRetry(() =>
      getPoolAddress(poolConfig.tokenA.address, poolConfig.tokenB.address, poolConfig.stable)
    );
  if (!poolAddress || poolAddress === ethers.ZeroAddress) {
    throw new Error(`Pool not found on-chain for ${poolConfig.name}`);
  }

  const gaugeAddress = poolConfig.gaugeAddress && poolConfig.gaugeAddress !== ethers.ZeroAddress
    ? poolConfig.gaugeAddress
    : await withRetry(() => getGaugeForPool(poolAddress));
  if (!gaugeAddress || gaugeAddress === ethers.ZeroAddress) {
    throw new Error(`Gauge not found for pool ${poolConfig.name}`);
  }

  return { poolAddress, gaugeAddress };
}

export async function executeEnterStrategy(
  req: PrepareEnterStrategyRequest
): Promise<PrepareEnterStrategyResponse> {
  const poolConfig = getStakingPoolById(req.poolId);
  if (!poolConfig) {
    throw new Error(`Staking pool not found: ${req.poolId}`);
  }

  const chain = getChainConfig("base");
  const protocol = getProtocolConfig("aerodrome");
  const executorAddress = chain.contracts.panoramaExecutor;
  if (!executorAddress) {
    throw new Error("Executor contract not configured");
  }
  let amountADesired = BigInt(req.amountA);
  let amountBDesired = BigInt(req.amountB);
  const slippageBps = req.slippageBps ?? 100;
  const deadlineMinutes = req.deadlineMinutes ?? 20;

  console.log(`[ENTER] user=${req.userAddress}, pool=${req.poolId}`);
  console.log(`[ENTER] requested amountA=${amountADesired}, amountB=${amountBDesired}`);
  console.log(`[ENTER] executor=${executorAddress}`);

  // Cap amounts to user's actual on-chain balance to avoid TransferFromFailed.
  // Fetch both token balances in parallel for faster prepare latency.
  const [balAResult, balBResult] = await Promise.all([
    !isNativeETH(poolConfig.tokenA.address)
      ? withRetry(async () => {
          const c = getContract(poolConfig.tokenA.address, ERC20_ABI, "base");
          return c.balanceOf(req.userAddress) as Promise<bigint>;
        }, 1, 250).catch(() => amountADesired)
      : Promise.resolve(amountADesired),
    !isNativeETH(poolConfig.tokenB.address)
      ? withRetry(async () => {
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
  const { poolAddress, gaugeAddress } = await resolvePoolAndGaugeFromConfig(poolConfig);

  // Reject if either amount is effectively zero after capping
  if (amountADesired === 0n) {
    throw new Error(`Insufficient ${poolConfig.tokenA.symbol} balance to enter this position`);
  }
  if (amountBDesired === 0n) {
    throw new Error(`Insufficient ${poolConfig.tokenB.symbol} balance to enter this position`);
  }

  // Query router for optimal amounts based on pool ratio
  const router = getContract(protocol.contracts.router, AERODROME_ROUTER_ABI, "base");
  const [optimalA, optimalB, estimatedLiquidity] = await withRetry(() =>
    router.quoteAddLiquidity(
      poolConfig.tokenA.address,
      poolConfig.tokenB.address,
      poolConfig.stable,
      protocol.contracts.factory,
      amountADesired,
      amountBDesired
    )
  );

  // Reject if estimated liquidity is zero (amounts too small or imbalanced)
  if (estimatedLiquidity === 0n) {
    throw new Error(
      `Cannot add liquidity: the provided amounts are too small or too imbalanced. ` +
      `Try increasing both ${poolConfig.tokenA.symbol} and ${poolConfig.tokenB.symbol} amounts.`
    );
  }

  // Use optimal amounts (what the router will actually use)
  // Apply slippage to the OPTIMAL amounts, not the desired amounts
  const amountAMin = applySlippage(optimalA, slippageBps);
  const amountBMin = applySlippage(optimalB, slippageBps);

  const steps: PreparedTransaction[] = [];
  const erc20Iface = new ethers.Interface(ERC20_ABI);
  const executorIface = new ethers.Interface(PANORAMA_EXECUTOR_ABI);

  // Step 1/2 - Approvals for tokenA/tokenB to Executor (if non-native).
  // Read allowances in parallel to reduce prepare latency.
  const [allowanceA, allowanceB] = await Promise.all([
    !isNativeETH(poolConfig.tokenA.address)
      ? withRetry(async () => {
          const c = getContract(poolConfig.tokenA.address, ERC20_ABI, "base");
          return c.allowance(req.userAddress, executorAddress) as Promise<bigint>;
        }, 1, 250).catch((e) => {
          console.error(`[ENTER] allowance check ${poolConfig.tokenA.symbol} FAILED:`, e instanceof Error ? e.message : e);
          return 0n;
        })
      : Promise.resolve(ethers.MaxUint256),
    !isNativeETH(poolConfig.tokenB.address)
      ? withRetry(async () => {
          const c = getContract(poolConfig.tokenB.address, ERC20_ABI, "base");
          return c.allowance(req.userAddress, executorAddress) as Promise<bigint>;
        }, 1, 250).catch((e) => {
          console.error(`[ENTER] allowance check ${poolConfig.tokenB.symbol} FAILED:`, e instanceof Error ? e.message : e);
          return 0n;
        })
      : Promise.resolve(ethers.MaxUint256),
  ]);

  if (!isNativeETH(poolConfig.tokenA.address)) {
    console.log(`[ENTER] ${poolConfig.tokenA.symbol} allowance=${allowanceA.toString()}, needed=${amountADesired.toString()}, skip=${allowanceA >= amountADesired}`);
    if (allowanceA < amountADesired) {
      steps.push({
        to: poolConfig.tokenA.address,
        data: erc20Iface.encodeFunctionData("approve", [executorAddress, ethers.MaxUint256]),
        value: "0",
        chainId: chain.chainId,
        description: `Approve ${poolConfig.tokenA.symbol}`,
      });
    }
  }

  if (!isNativeETH(poolConfig.tokenB.address)) {
    console.log(`[ENTER] ${poolConfig.tokenB.symbol} allowance=${allowanceB.toString()}, needed=${amountBDesired.toString()}, skip=${allowanceB >= amountBDesired}`);
    if (allowanceB < amountBDesired) {
      steps.push({
        to: poolConfig.tokenB.address,
        data: erc20Iface.encodeFunctionData("approve", [executorAddress, ethers.MaxUint256]),
        value: "0",
        chainId: chain.chainId,
        description: `Approve ${poolConfig.tokenB.symbol}`,
      });
    }
  }

  // Step 3 - Add Liquidity via PanoramaExecutor
  const protocolId = encodeProtocolId("aerodrome");
  const deadline = getDeadline(deadlineMinutes);

  let value = "0";
  if (isNativeETH(poolConfig.tokenA.address)) value = amountADesired.toString();
  else if (isNativeETH(poolConfig.tokenB.address)) value = amountBDesired.toString();

  steps.push({
    to: executorAddress,
    data: executorIface.encodeFunctionData("executeAddLiquidity", [
      protocolId,
      poolConfig.tokenA.address,
      poolConfig.tokenB.address,
      poolConfig.stable,
      amountADesired,
      amountBDesired,
      amountAMin,
      amountBMin,
      "0x",
      deadline,
    ]),
    value,
    chainId: chain.chainId,
    description: `Add liquidity to ${poolConfig.name}`,
  });

  // Step 4 - Approve LP token (pool address) to Executor (skip if already approved)
  const lpAllowance: bigint = await withRetry(async () => {
    const lp = getContract(poolAddress, ERC20_ABI, "base");
    return lp.allowance(req.userAddress, executorAddress) as Promise<bigint>;
  }, 1, 250).catch((e) => { console.error(`[ENTER] LP allowance check FAILED:`, e instanceof Error ? e.message : e); return 0n; });
  console.log(`[ENTER] LP allowance=${lpAllowance.toString()}, needed=${estimatedLiquidity.toString()}, skip=${lpAllowance >= estimatedLiquidity}`);
  if (lpAllowance < estimatedLiquidity) {
    steps.push({
      to: poolAddress,
      data: erc20Iface.encodeFunctionData("approve", [executorAddress, ethers.MaxUint256]),
      value: "0",
      chainId: chain.chainId,
      description: "Approve LP token",
    });
  }

  // Step 5 - Stake LP in Gauge via PanoramaExecutor
  // Use slippage-adjusted LP amount to account for difference between quote and actual
  const safeStakeAmount = applySlippage(estimatedLiquidity, slippageBps);
  const stakeExtraData = ethers.AbiCoder.defaultAbiCoder().encode(["address"], [gaugeAddress]);

  steps.push({
    to: executorAddress,
    data: executorIface.encodeFunctionData("executeStake", [
      protocolId,
      poolAddress,
      safeStakeAmount,
      stakeExtraData,
    ]),
    value: "0",
    chainId: chain.chainId,
    description: `Stake ${estimatedLiquidity.toString()} LP tokens in gauge`,
  });

  return {
    bundle: {
      steps,
      totalSteps: steps.length,
      summary: `Enter staking position: ${poolConfig.name}`,
    },
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
