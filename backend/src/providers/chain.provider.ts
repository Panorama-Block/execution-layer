import { ethers } from "ethers";
import { getChainConfig } from "../config/chains";

const baseNetwork = ethers.Network.from(8453);
const providers: Record<string, ethers.JsonRpcProvider> = {};

export function getProvider(chain: string): ethers.JsonRpcProvider {
  if (!providers[chain]) {
    const config = getChainConfig(chain);
    if (chain === "base") {
      providers[chain] = new ethers.JsonRpcProvider(config.rpcUrl, baseNetwork, { staticNetwork: baseNetwork });
    } else {
      providers[chain] = new ethers.JsonRpcProvider(config.rpcUrl);
    }
  }
  return providers[chain];
}

export function getContract(
  address: string,
  abi: readonly string[],
  chain: string
): ethers.Contract {
  const provider = getProvider(chain);
  return new ethers.Contract(address, abi, provider);
}
