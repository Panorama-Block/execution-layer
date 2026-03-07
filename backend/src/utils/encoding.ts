import { ethers } from "ethers";

const ETH_ADDRESS = "0x0000000000000000000000000000000000000000";

export function encodeProtocolId(name: string): string {
  return ethers.keccak256(ethers.toUtf8Bytes(name));
}

export function isNativeETH(address: string): boolean {
  return address === ETH_ADDRESS || address.toLowerCase() === ETH_ADDRESS;
}

export function encodeSwapExtraData(stable: boolean): string {
  return ethers.AbiCoder.defaultAbiCoder().encode(["bool"], [stable]);
}

export function encodeLiquidityExtraData(stable: boolean): string {
  return ethers.AbiCoder.defaultAbiCoder().encode(["bool"], [stable]);
}

export function getDeadline(minutesFromNow: number = 20): number {
  return Math.floor(Date.now() / 1000) + minutesFromNow * 60;
}

export function applySlippage(amount: bigint, slippageBps: number): bigint {
  return (amount * BigInt(10000 - slippageBps)) / BigInt(10000);
}
