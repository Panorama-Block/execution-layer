import { ethers } from "ethers";
import { aerodromeService } from "./services/aerodrome.service";
import { BundleBuilder, ADAPTER_SELECTORS } from "./bundle-builder";
import { encodeProtocolId, isNativeETH, applySlippage } from "../utils/encoding";

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

  const builder    = new BundleBuilder(chainId);
  const protocolId = encodeProtocolId("aerodrome");

  // Check allowances in parallel
  const [allowanceA, allowanceB, lpAllowance] = await Promise.all([
    !isNativeETH(tokenA.address)
      ? aerodromeService.withRetry(() =>
          aerodromeService.checkAllowance(tokenA.address, userAddress, executorAddress, amountADesired),
          1, 250
        ).catch((e) => {
          console.error(`[ADD_LIQ] allowance check ${tokenA.symbol} FAILED:`, e instanceof Error ? e.message : e);
          return { allowance: 0n, sufficient: false };
        })
      : Promise.resolve({ allowance: ethers.MaxUint256, sufficient: true }),
    !isNativeETH(tokenB.address)
      ? aerodromeService.withRetry(() =>
          aerodromeService.checkAllowance(tokenB.address, userAddress, executorAddress, amountBDesired),
          1, 250
        ).catch((e) => {
          console.error(`[ADD_LIQ] allowance check ${tokenB.symbol} FAILED:`, e instanceof Error ? e.message : e);
          return { allowance: 0n, sufficient: false };
        })
      : Promise.resolve({ allowance: ethers.MaxUint256, sufficient: true }),
    aerodromeService.withRetry(() =>
      aerodromeService.checkAllowance(poolAddress, userAddress, executorAddress, estimatedLiquidity),
      1, 250
    ).catch((e) => {
      console.error("[ADD_LIQ] LP allowance check FAILED:", e instanceof Error ? e.message : e);
      return { allowance: 0n, sufficient: false };
    }),
  ]);

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

  // stake
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

  return builder;
}
