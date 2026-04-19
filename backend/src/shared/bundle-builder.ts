import { ethers } from "ethers";
import { PreparedTransaction, TransactionBundle } from "../types/transaction";
import { getProvider } from "../providers/chain.provider";
import { logger } from "./logger";

/**
 * Solidity function selectors for adapter actions.
 * bytes4(keccak256("functionName(type,type,...)")) — standard Solidity ABI selectors.
 * PanoramaExecutorV2.execute() dispatches to the adapter using these selectors via low-level call.
 */

// ── Base (Aerodrome) selectors ──────────────────────────────────────────────
export const ADAPTER_SELECTORS = {
  SWAP:             ethers.id("swap(address,address,uint256,uint256,address,bool)").slice(0, 10),
  ADD_LIQUIDITY:    ethers.id("addLiquidity(address,address,bool,uint256,uint256,uint256,uint256,address)").slice(0, 10),
  REMOVE_LIQUIDITY: ethers.id("removeLiquidity(address,address,bool,uint256,uint256,uint256,address,address)").slice(0, 10),
  STAKE:            ethers.id("stake(address,uint256,address)").slice(0, 10),
  UNSTAKE:          ethers.id("unstake(address,uint256,address,address)").slice(0, 10),
  CLAIM_REWARDS:    ethers.id("claimRewards(address,address,address)").slice(0, 10),
} as const;

// ── Avalanche — TraderJoeAdapter selectors ──────────────────────────────────
export const TRADERJOE_SELECTORS = {
  SWAP:           ethers.id("swap(address,address,uint256,uint256,address)").slice(0, 10),
  SWAP_WITH_PATH: ethers.id("swapWithPath(uint256,uint256,address[],address)").slice(0, 10),
} as const;

// ── Avalanche — BenqiLendAdapter selectors ──────────────────────────────────
export const BENQI_SELECTORS = {
  SUPPLY:        ethers.id("supply(address,uint256,address)").slice(0, 10),
  REDEEM:        ethers.id("redeem(address,uint256,address)").slice(0, 10),
  BORROW:        ethers.id("borrow(address,uint256,address)").slice(0, 10),
  REPAY:         ethers.id("repay(address,uint256)").slice(0, 10),
  SUPPLY_AVAX:   ethers.id("supplyAVAX(address)").slice(0, 10),
  REDEEM_AVAX:   ethers.id("redeemAVAX(uint256,address)").slice(0, 10),
  BORROW_AVAX:   ethers.id("borrowAVAX(uint256,address)").slice(0, 10),
  REPAY_AVAX:    ethers.id("repayAVAX()").slice(0, 10),
  ENTER_MARKETS: ethers.id("enterMarkets(address[])").slice(0, 10),
} as const;

// ── Avalanche — SAVAXAdapter selectors ──────────────────────────────────────
export const SAVAX_SELECTORS = {
  STAKE:          ethers.id("stake(address)").slice(0, 10),
  REQUEST_UNLOCK: ethers.id("requestUnlock(uint256)").slice(0, 10),
  REDEEM:         ethers.id("redeem(uint256,address)").slice(0, 10),
} as const;

// ── Base — MetronomeAdapter selectors (ISynthMintAdapter family) ────────────
export const METRONOME_SELECTORS = {
  DEPOSIT_COLLATERAL:  ethers.id("depositCollateral(address,uint256)").slice(0, 10),
  WITHDRAW_COLLATERAL: ethers.id("withdrawCollateral(address,uint256,address)").slice(0, 10),
  MINT_SYNTH:          ethers.id("mintSynth(address,uint256,address)").slice(0, 10),
  REPAY_SYNTH:         ethers.id("repaySynth(address,uint256)").slice(0, 10),
  UNWIND:              ethers.id("unwind(address,address,address)").slice(0, 10),
} as const;

export const PANORAMA_EXECUTOR_ABI_EXECUTE = [
  "function execute(bytes32 protocolId, bytes4 action, (address token, uint256 amount)[] transfers, uint256 deadline, bytes data) external payable returns (bytes result)",
] as const;

export const ERC20_APPROVE_ABI = [
  "function approve(address spender, uint256 amount) external returns (bool)",
] as const;

/**
 * Fluent builder for TransactionBundle.
 * Eliminates repetitive steps[] construction across all usecases.
 */
export class BundleBuilder {
  private steps: PreparedTransaction[] = [];
  private readonly chainId: number;

  constructor(chainId: number) {
    this.chainId = chainId;
  }

  /**
   * Appends an ERC-20 approve step only if currentAllowance < requiredAmount.
   * Approves the exact amount to avoid Blockaid warnings for unlimited approvals.
   */
  addApproveIfNeeded(
    token: string,
    spender: string,
    currentAllowance: bigint,
    requiredAmount: bigint,
    description: string
  ): this {
    if (currentAllowance < requiredAmount) {
      const iface = new ethers.Interface(ERC20_APPROVE_ABI);
      this.steps.push({
        to: token,
        data: iface.encodeFunctionData("approve", [spender, requiredAmount]),
        value: "0",
        chainId: this.chainId,
        description,
      });
    }
    return this;
  }

  /**
   * Appends a PanoramaExecutorV2.execute() step.
   */
  addExecute(
    protocolId: string,
    action: string,
    transfers: Array<{ token: string; amount: bigint }>,
    deadline: number,
    adapterData: string,
    ethValue: bigint,
    executorAddress: string,
    description: string
  ): this {
    const iface = new ethers.Interface(PANORAMA_EXECUTOR_ABI_EXECUTE);
    const data  = iface.encodeFunctionData("execute", [
      protocolId,
      action,
      transfers,
      deadline,
      adapterData,
    ]);
    this.steps.push({
      to: executorAddress,
      data,
      value: ethValue.toString(),
      chainId: this.chainId,
      description,
    });
    return this;
  }

  build(summary: string): TransactionBundle {
    return {
      steps: [...this.steps],
      totalSteps: this.steps.length,
      summary,
    };
  }

  /**
   * Builds the bundle and estimates gas for each step using the chain's RPC provider.
   * This avoids MetaMask needing to call eth_estimateGas (which can be rate-limited).
   * Adds a 30% buffer to the estimate to prevent out-of-gas failures.
   */
  async buildWithGas(summary: string, fromAddress: string): Promise<TransactionBundle> {
    const chainName = CHAIN_ID_TO_NAME[this.chainId];
    if (!chainName) {
      logger.warn({ chainId: this.chainId }, "Unknown chainId for gas estimation, returning without gas");
      return this.build(summary);
    }

    const provider = getProvider(chainName);
    const stepsWithGas = await Promise.all(
      this.steps.map(async (step) => {
        try {
          const estimate = await provider.estimateGas({
            from: fromAddress,
            to: step.to,
            data: step.data,
            value: BigInt(step.value || "0"),
          });
          // 30% buffer
          const buffered = (estimate * 130n) / 100n;
          return { ...step, gas: `0x${buffered.toString(16)}` };
        } catch (err) {
          logger.warn(
            { step: step.description, error: err instanceof Error ? err.message : "unknown" },
            "Gas estimation failed for step, returning without gas"
          );
          return step;
        }
      })
    );

    return {
      steps: stepsWithGas,
      totalSteps: stepsWithGas.length,
      summary,
    };
  }
}

const CHAIN_ID_TO_NAME: Record<number, string> = {
  8453: "base",
  43114: "avalanche",
};
