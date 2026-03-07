import { ethers } from "ethers";
import { getChainConfig } from "../../../config/chains";
import { getStakingPoolById } from "../config/staking-pools";
import { getPoolAddress } from "../../../providers/aerodrome.provider";
import { getGaugeForPool } from "../../../providers/gauge.provider";
import { getContract } from "../../../providers/chain.provider";
import { PANORAMA_EXECUTOR_ABI, ERC20_ABI } from "../../../utils/abi";
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
  const amountA = BigInt(req.amountA);
  const amountB = BigInt(req.amountB);
  const slippageBps = req.slippageBps ?? 50;
  const deadlineMinutes = req.deadlineMinutes ?? 20;

  // Resolve pool and gauge addresses on-chain
  const poolAddress = await getPoolAddress(
    poolConfig.tokenA.address,
    poolConfig.tokenB.address,
    poolConfig.stable
  );
  if (poolAddress === ethers.ZeroAddress) {
    throw new Error(`Pool not found on-chain for ${poolConfig.name}`);
  }

  const gaugeAddress = await getGaugeForPool(poolAddress);
  if (gaugeAddress === ethers.ZeroAddress) {
    throw new Error(`Gauge not found for pool ${poolConfig.name}`);
  }

  const steps: PreparedTransaction[] = [];
  const erc20Iface = new ethers.Interface(ERC20_ABI);
  const executorIface = new ethers.Interface(PANORAMA_EXECUTOR_ABI);

  // Step 1 - Approve tokenA to Executor (if not native ETH)
  if (!isNativeETH(poolConfig.tokenA.address)) {
    const tokenAContract = getContract(poolConfig.tokenA.address, ERC20_ABI, "base");
    const allowanceA: bigint = await tokenAContract.allowance(req.userAddress, executorAddress);
    if (allowanceA < amountA) {
      steps.push({
        to: poolConfig.tokenA.address,
        data: erc20Iface.encodeFunctionData("approve", [executorAddress, amountA]),
        value: "0",
        chainId: chain.chainId,
        description: `Approve ${poolConfig.tokenA.symbol} for staking`,
      });
    }
  }

  // Step 2 - Approve tokenB to Executor (if not native ETH)
  if (!isNativeETH(poolConfig.tokenB.address)) {
    const tokenBContract = getContract(poolConfig.tokenB.address, ERC20_ABI, "base");
    const allowanceB: bigint = await tokenBContract.allowance(req.userAddress, executorAddress);
    if (allowanceB < amountB) {
      steps.push({
        to: poolConfig.tokenB.address,
        data: erc20Iface.encodeFunctionData("approve", [executorAddress, amountB]),
        value: "0",
        chainId: chain.chainId,
        description: `Approve ${poolConfig.tokenB.symbol} for staking`,
      });
    }
  }

  // Step 3 - Add Liquidity via PanoramaExecutor
  const protocolId = encodeProtocolId("aerodrome");
  const deadline = getDeadline(deadlineMinutes);
  const amountAMin = applySlippage(amountA, slippageBps);
  const amountBMin = applySlippage(amountB, slippageBps);

  let value = "0";
  if (isNativeETH(poolConfig.tokenA.address)) value = amountA.toString();
  else if (isNativeETH(poolConfig.tokenB.address)) value = amountB.toString();

  steps.push({
    to: executorAddress,
    data: executorIface.encodeFunctionData("executeAddLiquidity", [
      protocolId,
      poolConfig.tokenA.address,
      poolConfig.tokenB.address,
      poolConfig.stable,
      amountA,
      amountB,
      amountAMin,
      amountBMin,
      "0x",
      deadline,
    ]),
    value,
    chainId: chain.chainId,
    description: `Add liquidity to ${poolConfig.name}`,
  });

  // Step 4 - Approve LP token (pool address) to Executor
  steps.push({
    to: poolAddress,
    data: erc20Iface.encodeFunctionData("approve", [executorAddress, ethers.MaxUint256]),
    value: "0",
    chainId: chain.chainId,
    description: "Approve LP token for gauge staking",
  });

  // Step 5 - Stake LP in Gauge via PanoramaExecutor
  const stakeExtraData = ethers.AbiCoder.defaultAbiCoder().encode(["address"], [gaugeAddress]);

  steps.push({
    to: executorAddress,
    data: executorIface.encodeFunctionData("executeStake", [
      protocolId,
      poolAddress,
      BigInt(0),
      stakeExtraData,
    ]),
    value: "0",
    chainId: chain.chainId,
    description: "Stake LP tokens in gauge (update amount with actual LP balance after adding liquidity)",
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
      note: "After adding liquidity (step with description containing 'Add liquidity'), query your LP token balance at the poolAddress and use POST /execution/prepare-stake to stake the exact amount",
    },
  };
}
