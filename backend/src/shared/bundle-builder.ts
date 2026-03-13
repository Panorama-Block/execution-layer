import { ethers } from "ethers";
import { PreparedTransaction, TransactionBundle } from "../types/transaction";

/**
 * Solidity function selectors for IProtocolAdapter actions.
 * bytes4(keccak256("functionName(type,type,...)")) — standard Solidity ABI selectors.
 * PanoramaExecutor.execute() dispatches to the adapter using these selectors via low-level call.
 */
export const ADAPTER_SELECTORS = {
  SWAP:             ethers.id("swap(address,address,uint256,uint256,address,bool)").slice(0, 10),
  ADD_LIQUIDITY:    ethers.id("addLiquidity(address,address,bool,uint256,uint256,uint256,uint256,address)").slice(0, 10),
  REMOVE_LIQUIDITY: ethers.id("removeLiquidity(address,address,bool,uint256,uint256,uint256,address,address)").slice(0, 10),
  STAKE:            ethers.id("stake(address,uint256,address)").slice(0, 10),
  UNSTAKE:          ethers.id("unstake(address,uint256,address,address)").slice(0, 10),
  CLAIM_REWARDS:    ethers.id("claimRewards(address,address,address)").slice(0, 10),
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
   * Uses MaxUint256 to minimise future approval transactions.
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
   *
   * @param protocolId    bytes32 protocol identifier (hex string)
   * @param action        bytes4 adapter selector (from ADAPTER_SELECTORS)
   * @param transfers     Array of {token, amount} to pull from user into adapter
   * @param deadline      Unix timestamp deadline
   * @param adapterData   ABI-encoded parameters for the adapter function (without selector)
   * @param ethValue      msg.value in wei (for native ETH operations)
   * @param executorAddress  PanoramaExecutor contract address
   * @param description   Human-readable step description
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
}
