import { ethers } from "ethers";
import { aerodromeService } from "./services/aerodrome.service";
import { BundleBuilder, ADAPTER_SELECTORS } from "./bundle-builder";
import { encodeProtocolId, isNativeETH, applySlippage } from "../utils/encoding";
import { logger } from "./logger";

export interface AerodromeAddLiquidityBundleParams {
  userAddress: string;
  tokenA: { address: string; symbol: string };
  tokenB: { address: string; symbol: string };
  poolAddress: string;
  gaugeAddress: string;
  stable: boolean;
  amountADesired: bigint;
  amountBDesired: bigint;
  amountAMin: bigint;
  amountBMin: bigint;
  estimatedLiquidity: bigint;
  slippageBps: number;
  deadline: number;
  executorAddress: string;
  chainId: number;
  poolName: string;
}

/**
 * Builds an Aerodrome add-liquidity + stake bundle:
 *   approve tokenA (if needed) → approve tokenB (if needed)
 *   → addLiquidity → approve LP (if needed) → stake
 *
 * Shared between the staking module and any future consumer.
 */
export async function buildAerodromeAddLiquidityBundle(
  params: AerodromeAddLiquidityBundleParams
): Promise<BundleBuilder> {
  const {
    userAddress, tokenA, tokenB, poolAddress, gaugeAddress,
    stable, amountADesired, amountBDesired, amountAMin, amountBMin,
    estimatedLiquidity, slippageBps, deadline, executorAddress, chainId, poolName,
  } = params;

  const t0 = Date.now();
  const builder    = new BundleBuilder(chainId);
  const protocolId = encodeProtocolId("aerodrome");

  // Check allowances in parallel — each has the provider-level 3.5s timeout.
  logger.debug({ protocol: "aerodrome", pool: poolName }, "Checking 3 allowances in parallel");
  const [allowanceA, allowanceB, lpAllowance] = await Promise.all([
    !isNativeETH(tokenA.address)
      ? aerodromeService.checkAllowance(tokenA.address, userAddress, executorAddress, amountADesired)
        .catch((e) => {
          logger.error({ protocol: "aerodrome", token: tokenA.symbol, durationMs: Date.now() - t0, error: e instanceof Error ? e.message : e }, "Allowance check failed");
          return { allowance: 0n, sufficient: false };
        })
      : Promise.resolve({ allowance: ethers.MaxUint256, sufficient: true }),
    !isNativeETH(tokenB.address)
      ? aerodromeService.checkAllowance(tokenB.address, userAddress, executorAddress, amountBDesired)
        .catch((e) => {
          logger.error({ protocol: "aerodrome", token: tokenB.symbol, durationMs: Date.now() - t0, error: e instanceof Error ? e.message : e }, "Allowance check failed");
          return { allowance: 0n, sufficient: false };
        })
      : Promise.resolve({ allowance: ethers.MaxUint256, sufficient: true }),
    aerodromeService.checkAllowance(poolAddress, userAddress, executorAddress, estimatedLiquidity)
      .catch((e) => {
        logger.error({ protocol: "aerodrome", token: "LP", durationMs: Date.now() - t0, error: e instanceof Error ? e.message : e }, "LP allowance check failed");
        return { allowance: 0n, sufficient: false };
      }),
  ]);
  logger.info({ protocol: "aerodrome", pool: poolName, durationMs: Date.now() - t0, tokenA: allowanceA.sufficient, tokenB: allowanceB.sufficient, lp: lpAllowance.sufficient }, "Allowances checked");

  // Approve tokenA / tokenB
  if (!isNativeETH(tokenA.address)) {
    builder.addApproveIfNeeded(
      tokenA.address, executorAddress, allowanceA.allowance, amountADesired,
      `Approve ${tokenA.symbol}`
    );
  }

  if (!isNativeETH(tokenB.address)) {
    builder.addApproveIfNeeded(
      tokenB.address, executorAddress, allowanceB.allowance, amountBDesired,
      `Approve ${tokenB.symbol}`
    );
  }

  // addLiquidity
  const addLiqData = ethers.AbiCoder.defaultAbiCoder().encode(
    ["address", "address", "bool", "uint256", "uint256", "uint256", "uint256", "address"],
    [tokenA.address, tokenB.address, stable, amountADesired, amountBDesired, amountAMin, amountBMin, userAddress]
  );

  let ethValue = 0n;
  if (isNativeETH(tokenA.address)) ethValue = amountADesired;
  else if (isNativeETH(tokenB.address)) ethValue = amountBDesired;

  const addLiqTransfers: Array<{ token: string; amount: bigint }> = [];
  if (!isNativeETH(tokenA.address)) addLiqTransfers.push({ token: tokenA.address, amount: amountADesired });
  if (!isNativeETH(tokenB.address)) addLiqTransfers.push({ token: tokenB.address, amount: amountBDesired });

  builder.addExecute(
    protocolId, ADAPTER_SELECTORS.ADD_LIQUIDITY,
    addLiqTransfers, deadline, addLiqData, ethValue,
    executorAddress, `Add liquidity to ${poolName}`
  );

  // Approve LP token
  builder.addApproveIfNeeded(
    poolAddress, executorAddress, lpAllowance.allowance, estimatedLiquidity,
    "Approve LP token"
  );

  // stake — apply slippage twice to create a safety margin between the LP
  // amount quoted at prepare-time and the actual LP minted at execute-time.
  // Single slippage (1%) fails when pool moves >1% in the ~30-60s between
  // prepare and execute. Double slippage (2×) widens the safe window while
  // still failing fast if the amount is grossly insufficient.
  const safeStakeAmount = applySlippage(applySlippage(estimatedLiquidity, slippageBps), slippageBps);
  const stakeData = ethers.AbiCoder.defaultAbiCoder().encode(
    ["address", "uint256", "address"],
    [poolAddress, safeStakeAmount, gaugeAddress]
  );

  builder.addExecute(
    protocolId, ADAPTER_SELECTORS.STAKE,
    [{ token: poolAddress, amount: safeStakeAmount }], deadline, stakeData, 0n,
    executorAddress, `Stake LP tokens in ${poolName} gauge`
  );

  return builder;
}
