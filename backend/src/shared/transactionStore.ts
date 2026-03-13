import fs from "fs";
import path from "path";
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

// ---- Persistence ----
const DATA_DIR  = path.join(process.cwd(), "data");
const DATA_FILE = path.join(DATA_DIR, "transactions.json");

function ensureDataDir(): void {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function loadFromDisk(): Map<string, StoredTransaction> {
  ensureDataDir();
  try {
    if (fs.existsSync(DATA_FILE)) {
      const raw = fs.readFileSync(DATA_FILE, "utf-8");
      const arr: StoredTransaction[] = JSON.parse(raw);
      return new Map(arr.map(tx => [tx.txHash, tx]));
    }
  } catch {
    // Corrupted file — start fresh
  }
  return new Map();
}

function saveToDisk(): void {
  ensureDataDir();
  const arr = Array.from(transactions.values());
  fs.writeFileSync(DATA_FILE, JSON.stringify(arr, null, 2), "utf-8");
}

// In-memory store, hydrated from disk on startup.
const transactions = loadFromDisk();
const userIndex = new Map<string, string[]>(); // userAddress → txHash[]

// Rebuild user index from loaded transactions
for (const tx of transactions.values()) {
  const list = userIndex.get(tx.userAddress) ?? [];
  if (!list.includes(tx.txHash)) list.push(tx.txHash);
  userIndex.set(tx.userAddress, list);
}

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

  saveToDisk();

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
        saveToDisk();
        return;
      }
    } catch {
      // RPC error, keep polling
    }
  }
}
