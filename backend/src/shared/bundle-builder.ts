import { ethers } from "ethers";
import { PreparedTransaction, TransactionBundle } from "../types/transaction";

export const ADAPTER_SELECTORS = {
  SWAP:             ethers.id("swap").slice(0, 10),
  ADD_LIQUIDITY:    ethers.id("addLiquidity").slice(0, 10),
  REMOVE_LIQUIDITY: ethers.id("removeLiquidity").slice(0, 10),
  STAKE:            ethers.id("stake").slice(0, 10),
  UNSTAKE:          ethers.id("unstake").slice(0, 10),
  CLAIM_REWARDS:    ethers.id("claimRewards").slice(0, 10),
} as const;

export const PANORAMA_EXECUTOR_ABI_EXECUTE = [
  "function execute(bytes32 protocolId, bytes4 selector, (address token, uint256 amount)[] transfers, uint256 deadline, bytes data) external payable returns (bytes result)",
] as const;

export const ERC20_APPROVE_ABI = [
  "function approve(address spender, uint256 amount) external returns (bool)",
] as const;

/**
 * Fluent builder for TransactionBundle. Eliminates repetitive steps[] construction.
 */
export class BundleBuilder {
  private steps: PreparedTransaction[] = [];
  private readonly chainId: number;

  constructor(chainId: number) {
    this.chainId = chainId;
  }

  /**
   * Appends an ERC-20 approve step only if currentAllowance < requiredAmount.
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
        data: iface.encodeFunctionData("approve", [spender, ethers.MaxUint256]),
        value: "0",
        chainId: this.chainId,
        description,
      });
    }
    return this;
  }

  /**
   * Appends a PanoramaExecutor.execute() step.
   * @param protocolId  bytes32 protocol identifier (hex string)
   * @param selector    bytes4 adapter selector (e.g. ADAPTER_SELECTORS.SWAP)
   * @param transfers   Array of {token, amount} to pull from user into adapter
   * @param deadline    Unix timestamp deadline
   * @param adapterData ABI-encoded data for the adapter
   * @param ethValue    msg.value in wei (for native ETH operations)
   * @param executorAddress  PanoramaExecutor contract address
   * @param description Human-readable description
   */
  addExecute(
    protocolId: string,
    selector: string,
    transfers: Array<{ token: string; amount: bigint }>,
    deadline: number,
    adapterData: string,
    ethValue: bigint,
    executorAddress: string,
    description: string
  ): this {
    const iface = new ethers.Interface(PANORAMA_EXECUTOR_ABI_EXECUTE);
    const data = iface.encodeFunctionData("execute", [
      protocolId,
      selector,
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
}
