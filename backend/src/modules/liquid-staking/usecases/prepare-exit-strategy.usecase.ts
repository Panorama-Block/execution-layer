import { ethers } from "ethers";
import { getChainConfig } from "../../../config/chains";
import { getStakingPoolById } from "../config/staking-pools";
import { getPoolAddress } from "../../../providers/aerodrome.provider";
import { getGaugeForPool, getStakedBalance } from "../../../providers/gauge.provider";
import { getContract } from "../../../providers/chain.provider";
import { PANORAMA_EXECUTOR_ABI, ERC20_ABI } from "../../../utils/abi";
import { encodeProtocolId, getDeadline } from "../../../utils/encoding";
import { PreparedTransaction, TransactionBundle } from "../../../types/transaction";

export interface PrepareExitStrategyRequest {
  userAddress: string;
  poolId: string;
  amount?: string; // LP amount in wei. If omitted, exits full position.
  deadlineMinutes?: number;
}

export interface PrepareExitStrategyResponse {
  bundle: TransactionBundle;
  metadata: {
    poolId: string;
    poolAddress: string;
    gaugeAddress: string;
    lpAmount: string;
    tokenA: { symbol: string; address: string; decimals: number };
    tokenB: { symbol: string; address: string; decimals: number };
    stable: boolean;
  };
}

export async function executeExitStrategy(
  req: PrepareExitStrategyRequest
): Promise<PrepareExitStrategyResponse> {
  const poolConfig = getStakingPoolById(req.poolId);
  if (!poolConfig) {
    throw new Error(`Staking pool not found: ${req.poolId}`);
  }

  const chain = getChainConfig("base");
  const executorAddress = chain.contracts.panoramaExecutor;
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

  // Determine LP amount to unstake
  const stakedBalance = await getStakedBalance(gaugeAddress, req.userAddress);
  const lpAmount = req.amount ? BigInt(req.amount) : stakedBalance;

  if (lpAmount === 0n) {
    throw new Error(`No staked position found for ${poolConfig.name}`);
  }
  if (lpAmount > stakedBalance) {
    throw new Error(`Insufficient staked balance. Have: ${stakedBalance.toString()}, requested: ${lpAmount.toString()}`);
  }

  const steps: PreparedTransaction[] = [];
  const erc20Iface = new ethers.Interface(ERC20_ABI);
  const executorIface = new ethers.Interface(PANORAMA_EXECUTOR_ABI);
  const protocolId = encodeProtocolId("aerodrome");
  const deadline = getDeadline(deadlineMinutes);

  // Step 1 - Unstake LP from Gauge via PanoramaExecutor
  const unstakeExtraData = ethers.AbiCoder.defaultAbiCoder().encode(["address"], [gaugeAddress]);

  steps.push({
    to: executorAddress,
    data: executorIface.encodeFunctionData("executeUnstake", [
      protocolId,
      poolAddress,
      lpAmount,
      unstakeExtraData,
    ]),
    value: "0",
    chainId: chain.chainId,
    description: `Unstake LP tokens from ${poolConfig.name} gauge`,
  });

  // Step 2 - Approve LP token to Executor for removeLiquidity
  const lpContract = getContract(poolAddress, ERC20_ABI, "base");
  const currentAllowance: bigint = await lpContract.allowance(req.userAddress, executorAddress);
  if (currentAllowance < lpAmount) {
    steps.push({
      to: poolAddress,
      data: erc20Iface.encodeFunctionData("approve", [executorAddress, lpAmount]),
      value: "0",
      chainId: chain.chainId,
      description: "Approve LP token for removing liquidity",
    });
  }

  // Step 3 - Remove Liquidity via PanoramaExecutor
  const removeExtraData = ethers.AbiCoder.defaultAbiCoder().encode(["address"], [poolAddress]);

  steps.push({
    to: executorAddress,
    data: executorIface.encodeFunctionData("executeRemoveLiquidity", [
      protocolId,
      poolConfig.tokenA.address,
      poolConfig.tokenB.address,
      poolConfig.stable,
      lpAmount,
      BigInt(0), // amountAMin - 0 for simplicity, frontend can adjust
      BigInt(0), // amountBMin
      removeExtraData,
      deadline,
    ]),
    value: "0",
    chainId: chain.chainId,
    description: `Remove liquidity from ${poolConfig.name}`,
  });

  return {
    bundle: {
      steps,
      totalSteps: steps.length,
      summary: `Exit staking position: ${poolConfig.name}`,
    },
    metadata: {
      poolId: poolConfig.id,
      poolAddress,
      gaugeAddress,
      lpAmount: lpAmount.toString(),
      tokenA: poolConfig.tokenA,
      tokenB: poolConfig.tokenB,
      stable: poolConfig.stable,
    },
  };
}
