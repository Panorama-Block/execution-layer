import { getContract } from "../../providers/chain.provider";
import { TRADER_JOE_ROUTER_ABI, TJ_FACTORY_ABI, MASTERCHEF_JOE_ABI, ERC20_ABI } from "../../utils/abi";

const TJ_ROUTER      = "0x60aE616a2155Ee3d9A68541Ba4544862310933d4";
const TJ_FACTORY     = "0x9Ad6C38BE94206cA50bb0d90783171662CD1e917";
export const MASTERCHEF_V3 = "0x188bED1968b795d5c9022F6a0bb5931Ac4c18F00";
export const JOE_TOKEN     = "0x6e84a6216eA6dACC71eE8E6b0a5B7322EEbC0fDd";

function withTimeout<T>(fn: () => Promise<T>, ms = 10_000): Promise<T> {
  return Promise.race([
    fn(),
    new Promise<never>((_, r) => setTimeout(() => r(new Error("avax-lp timeout")), ms)),
  ]);
}

class AvaxLpService {
  // ── Router / Factory ──────────────────��──────────────────────────────────

  private get router() {
    return getContract(TJ_ROUTER, TRADER_JOE_ROUTER_ABI, "avalanche");
  }

  private get factory() {
    return getContract(TJ_FACTORY, TJ_FACTORY_ABI, "avalanche");
  }

  private get masterChef() {
    return getContract(MASTERCHEF_V3, MASTERCHEF_JOE_ABI, "avalanche");
  }

  // ── Pair helpers ───────────────────────���──────────────────────────���──────

  async getPairAddress(tokenA: string, tokenB: string): Promise<string> {
    return withTimeout(() => this.factory.getPair(tokenA, tokenB) as Promise<string>);
  }

  async getLpBalance(pairAddress: string, owner: string): Promise<bigint> {
    try {
      const lp = getContract(pairAddress, ERC20_ABI, "avalanche");
      return await withTimeout(() => lp.balanceOf(owner) as Promise<bigint>);
    } catch { return 0n; }
  }

  async checkLpAllowance(pairAddress: string, owner: string, spender: string): Promise<bigint> {
    try {
      const lp = getContract(pairAddress, ERC20_ABI, "avalanche");
      return await withTimeout(() => lp.allowance(owner, spender) as Promise<bigint>);
    } catch { return 0n; }
  }

  // ── Quote helpers ──────────────────────────────────────────���──────────────

  async quoteAddLiquidity(
    tokenA: string,
    tokenB: string,
    amountADesired: bigint,
    amountBDesired: bigint
  ): Promise<{ amountA: bigint; amountB: bigint }> {
    // TraderJoe V1 doesn't expose quoteAddLiquidity — use reserve ratio to estimate.
    // For now we return desired amounts; the router handles the actual ratio on-chain.
    return { amountA: amountADesired, amountB: amountBDesired };
  }

  // ── Farm helpers ───────────────────────────────────────────────────────��──

  async getUserFarmInfo(pid: number, proxyAddress: string): Promise<{ amount: bigint; rewardDebt: bigint }> {
    try {
      const [amount, rewardDebt] = await withTimeout(
        () => this.masterChef.userInfo(pid, proxyAddress) as Promise<[bigint, bigint]>
      );
      return { amount, rewardDebt };
    } catch { return { amount: 0n, rewardDebt: 0n }; }
  }

  async getPendingRewards(pid: number, proxyAddress: string): Promise<bigint> {
    try {
      const [pendingJoe] = await withTimeout(
        () => this.masterChef.pendingTokens(pid, proxyAddress) as Promise<[bigint, string, string, bigint]>
      );
      return pendingJoe;
    } catch { return 0n; }
  }
}

export const avaxLpService = new AvaxLpService();
