export interface ProtocolConfig {
  protocolId: string;
  name: string;
  chain: string;
  contracts: {
    router: string;
    factory: string;
    voter: string;
  };
  adapterAddress: string;
}

export const PROTOCOLS: Record<string, ProtocolConfig> = {
  aerodrome: {
    protocolId: "aerodrome",
    name: "Aerodrome Finance",
    chain: "base",
    contracts: {
      router: "0xcF77a3Ba9A5CA399B7c97c74d54e5b1Beb874E43",
      factory: "0x420DD381b31aEf6683db6B902084cB0FFECe40Da",
      voter: "0x16613524e02ad97eDfeF371bC883F2F5d6C480A5",
    },
    adapterAddress: process.env.AERODROME_ADAPTER_ADDRESS || "",
  },
};

export const BASE_TOKENS: Record<string, { address: string; decimals: number }> = {
  ETH: { address: "0x0000000000000000000000000000000000000000", decimals: 18 },
  WETH: { address: "0x4200000000000000000000000000000000000006", decimals: 18 },
  USDC: { address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", decimals: 6 },
  USDbC: { address: "0xd9aAEc86B65D86f6A7B5B1b0c42FFA531710b6CA", decimals: 6 },
  AERO: { address: "0x940181a94A35A4569E4529A3CDfB74e38FD98631", decimals: 18 },
  cbBTC: { address: "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf", decimals: 8 },
};

export function getProtocolConfig(protocolId: string): ProtocolConfig {
  const config = PROTOCOLS[protocolId];
  if (!config) {
    throw new Error(`Unsupported protocol: ${protocolId}`);
  }
  return config;
}
