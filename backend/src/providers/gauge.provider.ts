import { getContract } from "./chain.provider";
import { getProtocolConfig } from "../config/protocols";
import { GAUGE_ABI, VOTER_ABI } from "../utils/abi";

const CHAIN = "base";

export async function getGaugeForPool(poolAddress: string): Promise<string> {
  const config = getProtocolConfig("aerodrome");
  const voter = getContract(config.contracts.voter, VOTER_ABI, CHAIN);
  return voter.gauges(poolAddress);
}

export async function getStakedBalance(
  gaugeAddress: string,
  userAddress: string
): Promise<bigint> {
  const gauge = getContract(gaugeAddress, GAUGE_ABI, CHAIN);
  return gauge.balanceOf(userAddress);
}

export async function getEarnedRewards(
  gaugeAddress: string,
  userAddress: string
): Promise<bigint> {
  const gauge = getContract(gaugeAddress, GAUGE_ABI, CHAIN);
  return gauge.earned(userAddress);
}

export async function getRewardRate(gaugeAddress: string): Promise<bigint> {
  const gauge = getContract(gaugeAddress, GAUGE_ABI, CHAIN);
  return gauge.rewardRate();
}

export async function getRewardToken(gaugeAddress: string): Promise<string> {
  const gauge = getContract(gaugeAddress, GAUGE_ABI, CHAIN);
  return gauge.rewardToken();
}
