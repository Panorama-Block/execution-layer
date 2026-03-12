import { ethers } from "ethers";
import { getChainConfig } from "../../../config/chains";
import { getStakingPoolById } from "../config/staking-pools";
import { encodeProtocolId, getDeadline } from "../../../utils/encoding";
import { TransactionBundle } from "../../../types/transaction";
import { aerodromeService } from "../../../shared/services/aerodrome.service";
import { BundleBuilder, ADAPTER_SELECTORS } from "../../../shared/bundle-builder";

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
    lpFromStaked: string;
    lpFromWallet: string;
    stakedBalance: string;
    walletLpBalance: string;
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

  // Resolve pool/gauge from canonical config first, fallback to on-chain.
  const { poolAddress, gaugeAddress } = await aerodromeService.resolvePoolAndGauge(poolConfig);

  // Determine LP amount source: staked in gauge and/or already in wallet.
  const userAdapter = await aerodromeService.getUserAdapterAddress(req.userAddress, "aerodrome");
  const stakedBalance = userAdapter
    ? await aerodromeService.getStakedBalance(gaugeAddress, userAdapter).catch(() => 0n)
    : 0n;
  const walletLpBalance = await aerodromeService
    .getTokenBalance(poolAddress, req.userAddress)
    .catch(() => 0n);
  const totalAvailable = stakedBalance + walletLpBalance;
  const lpAmount = req.amount ? BigInt(req.amount) : totalAvailable;

  if (lpAmount === 0n) {
    throw new Error(`No LP position found for ${poolConfig.name}`);
  }
  if (lpAmount > totalAvailable) {
    throw new Error(
      `Insufficient LP balance. Have total: ${totalAvailable.toString()} ` +
      `(staked=${stakedBalance.toString()}, wallet=${walletLpBalance.toString()}), ` +
      `requested: ${lpAmount.toString()}`
    );
  }

  const lpFromStaked = lpAmount > stakedBalance ? stakedBalance : lpAmount;
  const lpFromWallet = lpAmount - lpFromStaked;

  const protocolId = encodeProtocolId("aerodrome");
  const deadline   = getDeadline(deadlineMinutes);
  const builder    = new BundleBuilder(chain.chainId);

  // Step 1 - Unstake only the portion currently staked in gauge (if any).
  if (lpFromStaked > 0n) {
    const unstakeData = ethers.AbiCoder.defaultAbiCoder().encode(
      ["address", "uint256", "address", "address"],
      [poolAddress, lpFromStaked, gaugeAddress, req.userAddress]
    );
    builder.addExecute(
      protocolId, ADAPTER_SELECTORS.UNSTAKE,
      [], deadline, unstakeData, 0n,
      executorAddress, `Unstake LP tokens from ${poolConfig.name} gauge`
    );
  }

  // Step 2 - Approve LP token to Executor for removeLiquidity
  const { allowance: currentAllowance } = await aerodromeService
    .checkAllowance(poolAddress, req.userAddress, executorAddress, lpAmount)
    .catch(() => ({ allowance: 0n, sufficient: false }));

  builder.addApproveIfNeeded(
    poolAddress, executorAddress, currentAllowance, lpAmount,
    "Approve LP token for removing liquidity"
  );

  // Step 3 - Remove Liquidity via PanoramaExecutor
  const removeData = ethers.AbiCoder.defaultAbiCoder().encode(
    ["address", "address", "bool", "uint256", "uint256", "uint256", "address", "address"],
    [poolConfig.tokenA.address, poolConfig.tokenB.address, poolConfig.stable,
     lpAmount, 0n, 0n, req.userAddress, poolAddress]
  );

  builder.addExecute(
    protocolId, ADAPTER_SELECTORS.REMOVE_LIQUIDITY,
    [{ token: poolAddress, amount: lpAmount }], deadline, removeData, 0n,
    executorAddress, `Remove liquidity from ${poolConfig.name}`
  );

  return {
    bundle: builder.build(`Exit staking position: ${poolConfig.name}`),
    metadata: {
      poolId: poolConfig.id,
      poolAddress,
      gaugeAddress,
      lpAmount: lpAmount.toString(),
      lpFromStaked: lpFromStaked.toString(),
      lpFromWallet: lpFromWallet.toString(),
      stakedBalance: stakedBalance.toString(),
      walletLpBalance: walletLpBalance.toString(),
      tokenA: poolConfig.tokenA,
      tokenB: poolConfig.tokenB,
      stable: poolConfig.stable,
    },
  };
}
