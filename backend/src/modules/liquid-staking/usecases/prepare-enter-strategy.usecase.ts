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

  // Cap amounts to user's actual on-chain balance to avoid TransferFromFailed
  // (frontend formatting roundtrips can produce values slightly above actual balance)
  if (!isNativeETH(poolConfig.tokenA.address)) {
    const balA: bigint = await withRetry(async () => {
      const c = getContract(poolConfig.tokenA.address, ERC20_ABI, "base");
      return c.balanceOf(req.userAddress) as Promise<bigint>;
    }).catch(() => amountADesired);
    if (amountADesired > balA) amountADesired = balA;
  }
  if (!isNativeETH(poolConfig.tokenB.address)) {
    const balB: bigint = await withRetry(async () => {
      const c = getContract(poolConfig.tokenB.address, ERC20_ABI, "base");
      return c.balanceOf(req.userAddress) as Promise<bigint>;
    }).catch(() => amountBDesired);
    if (amountBDesired > balB) amountBDesired = balB;
  }

  // Resolve pool and gauge addresses on-chain (with retry for RPC flakiness)
  const poolAddress = await withRetry(() =>
    getPoolAddress(poolConfig.tokenA.address, poolConfig.tokenB.address, poolConfig.stable)
  );
  if (poolAddress === ethers.ZeroAddress) {
    throw new Error(`Pool not found on-chain for ${poolConfig.name}`);
  }

  const gaugeAddress = await withRetry(() => getGaugeForPool(poolAddress));
  if (gaugeAddress === ethers.ZeroAddress) {
    throw new Error(`Gauge not found for pool ${poolConfig.name}`);
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

  // Use optimal amounts (what the router will actually use)
  // Apply slippage to the OPTIMAL amounts, not the desired amounts
  const amountAMin = applySlippage(optimalA, slippageBps);
  const amountBMin = applySlippage(optimalB, slippageBps);

  const steps: PreparedTransaction[] = [];
  const erc20Iface = new ethers.Interface(ERC20_ABI);
  const executorIface = new ethers.Interface(PANORAMA_EXECUTOR_ABI);

  // Step 1 - Approve tokenA to Executor (if not native ETH)
  // Use MaxUint256 so approval only happens once per token
  if (!isNativeETH(poolConfig.tokenA.address)) {
    const allowanceA: bigint = await withRetry(async () => {
      const c = getContract(poolConfig.tokenA.address, ERC20_ABI, "base");
      return c.allowance(req.userAddress, executorAddress) as Promise<bigint>;
    }).catch(() => 0n);
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

  // Step 2 - Approve tokenB to Executor (if not native ETH)
  if (!isNativeETH(poolConfig.tokenB.address)) {
    const allowanceB: bigint = await withRetry(async () => {
      const c = getContract(poolConfig.tokenB.address, ERC20_ABI, "base");
      return c.allowance(req.userAddress, executorAddress) as Promise<bigint>;
    }).catch(() => 0n);
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
  }).catch(() => 0n);
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
