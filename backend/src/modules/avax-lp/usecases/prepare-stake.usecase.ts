import { ethers } from "ethers";
import { getChainConfig } from "../../../config/chains";
import { avaxLpService } from "../../../shared/services/avax-lp.service";
import { getDeadline, encodeProtocolId } from "../../../utils/encoding";
import { BundleBuilder, TRADERJOE_LP_SELECTORS } from "../../../shared/bundle-builder";
import { TransactionBundle } from "../../../types/transaction";
import { AppError } from "../../../shared/errorCodes";
import { logger } from "../../../shared/logger";
import { getPoolById } from "../config/avax-lp-pools";

export interface PrepareStakeRequest {
  userAddress: string;
  poolId:      string; // e.g. "wavax-usdc.e"
  lpAmount:    string; // LP token amount in wei
}

export interface PrepareStakeResponse {
  bundle:   TransactionBundle;
  metadata: {
    action:      "stake";
    poolId:      string;
    pairAddress: string;
    farmPid:     number;
    lpAmount:    string;
  };
}

export async function executePrepareStake(req: PrepareStakeRequest): Promise<PrepareStakeResponse> {
  logger.info({ chain: "avalanche", protocol: "traderjoe-lp", action: "stake", user: req.userAddress, poolId: req.poolId }, "Prepare stake request");

  const chain        = getChainConfig("avalanche");
  const executorAddr = chain.contracts.panoramaExecutor;
  if (!executorAddr) throw new AppError("INTERNAL_ERROR", "PanoramaExecutor not deployed on Avalanche");

  const pool = getPoolById(req.poolId);
  if (!pool) throw new AppError("POOL_NOT_FOUND", `Pool not found: ${req.poolId}`);
  if (pool.farmPid === null) throw new AppError("UNSUPPORTED_OPERATION", `Pool ${req.poolId} has no active farm`);

  const lpAmount = BigInt(req.lpAmount);
  if (lpAmount === 0n) throw new AppError("INVALID_AMOUNT", "lpAmount must be positive");

  const lpBalance = await avaxLpService.getLpBalance(pool.pairAddress, req.userAddress);
  if (lpBalance < lpAmount) throw new AppError("INSUFFICIENT_LP_BALANCE", `Need ${lpAmount}, have ${lpBalance}`);

  const deadline   = getDeadline(5);
  const protocolId = encodeProtocolId("traderjoe");
  const builder    = new BundleBuilder(chain.chainId);

  // Approve LP token → executor
  const lpAllowance = await avaxLpService.checkLpAllowance(pool.pairAddress, req.userAddress, executorAddr);
  builder.addApproveIfNeeded(
    pool.pairAddress,
    executorAddr,
    lpAllowance,
    lpAmount,
    `Approve ${pool.tokenA.symbol}/${pool.tokenB.symbol} LP for staking`
  );

  // stake(pid, amount, lpToken, recipient)
  const adapterData = ethers.AbiCoder.defaultAbiCoder().encode(
    ["uint256", "uint256", "address", "address"],
    [pool.farmPid, lpAmount, pool.pairAddress, req.userAddress]
  );

  builder.addExecute(
    protocolId,
    TRADERJOE_LP_SELECTORS.STAKE,
    [{ token: pool.pairAddress, amount: lpAmount }],
    deadline,
    adapterData,
    0n,
    executorAddr,
    `Stake ${pool.tokenA.symbol}/${pool.tokenB.symbol} LP in TraderJoe farm`
  );

  const bundle = await builder.buildWithGas(
    `Stake ${pool.tokenA.symbol}/${pool.tokenB.symbol} LP on TraderJoe Farm`,
    req.userAddress
  );

  logger.info({ chain: "avalanche", protocol: "traderjoe-lp", pool: pool.id, pid: pool.farmPid, steps: bundle.totalSteps }, "stake bundle built");

  return {
    bundle,
    metadata: {
      action:      "stake",
      poolId:      pool.id,
      pairAddress: pool.pairAddress,
      farmPid:     pool.farmPid,
      lpAmount:    lpAmount.toString(),
    },
  };
}
