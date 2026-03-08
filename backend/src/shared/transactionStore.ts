import { getProvider } from "../providers/chain.provider";

export type TxStatus = "pending" | "confirmed" | "failed";
export type TxModule = "staking" | "swap" | "dca" | "execution";

export interface StoredTransaction {
  txHash: string;
  userAddress: string;
  module: TxModule;
  action: string;
  status: TxStatus;
  chainId: number;
  blockNumber?: number;
  gasUsed?: string;
  submittedAt: string;
  confirmedAt?: string;
}

// In-memory store — sufficient for hackathon MVP.
// Production would use PostgreSQL.
const transactions = new Map<string, StoredTransaction>();
const userIndex = new Map<string, string[]>(); // userAddress → txHash[]

export function submitTransaction(
  txHash: string,
  userAddress: string,
  module: TxModule,
  action: string,
  chainId: number = 8453
): StoredTransaction {
  const tx: StoredTransaction = {
    txHash: txHash.toLowerCase(),
    userAddress: userAddress.toLowerCase(),
    module,
    action,
    status: "pending",
    chainId,
    submittedAt: new Date().toISOString(),
  };

  transactions.set(tx.txHash, tx);

  const key = tx.userAddress;
  const list = userIndex.get(key) ?? [];
  list.push(tx.txHash);
  userIndex.set(key, list);

  // Fire-and-forget: poll for confirmation
  pollConfirmation(tx.txHash).catch(() => {});

  return tx;
}

export function getTransaction(txHash: string): StoredTransaction | undefined {
  return transactions.get(txHash.toLowerCase());
}

export function getUserTransactions(userAddress: string): StoredTransaction[] {
  const hashes = userIndex.get(userAddress.toLowerCase()) ?? [];
  return hashes
    .map(h => transactions.get(h))
    .filter((t): t is StoredTransaction => !!t)
    .sort((a, b) => new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime());
}

async function pollConfirmation(txHash: string, maxAttempts = 30): Promise<void> {
  const provider = getProvider("base");
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise(r => setTimeout(r, 5000));
    const tx = transactions.get(txHash);
    if (!tx || tx.status !== "pending") return;

    try {
      const receipt = await provider.getTransactionReceipt(txHash);
      if (receipt) {
        tx.status = receipt.status === 1 ? "confirmed" : "failed";
        tx.blockNumber = receipt.blockNumber;
        tx.gasUsed = receipt.gasUsed.toString();
        tx.confirmedAt = new Date().toISOString();
        return;
      }
    } catch {
      // RPC error, keep polling
    }
  }
}
