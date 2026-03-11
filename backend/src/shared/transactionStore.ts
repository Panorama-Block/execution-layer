import { existsSync, readFileSync } from "fs";
import { mkdir, writeFile } from "fs/promises";
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

const STORE_DIR = path.resolve(process.cwd(), "data");
const STORE_FILE = path.join(STORE_DIR, "transactions.json");

const transactions = new Map<string, StoredTransaction>();
const userIndex = new Map<string, string[]>(); // userAddress → txHash[]
let storeLoaded = false;
let persistChain: Promise<void> = Promise.resolve();

export function submitTransaction(
  txHash: string,
  userAddress: string,
  module: TxModule,
  action: string,
  chainId: number = 8453
): StoredTransaction {
  ensureLoaded();

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
  void persistStore();

  return tx;
}

export function getTransaction(txHash: string): StoredTransaction | undefined {
  ensureLoaded();
  return transactions.get(txHash.toLowerCase());
}

export function getUserTransactions(userAddress: string): StoredTransaction[] {
  ensureLoaded();
  const hashes = userIndex.get(userAddress.toLowerCase()) ?? [];
  return hashes
    .map(h => transactions.get(h))
    .filter((t): t is StoredTransaction => !!t)
    .sort((a, b) => new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime());
}

async function pollConfirmation(txHash: string, maxAttempts = 30): Promise<void> {
  ensureLoaded();
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
        await persistStore();
        return;
      }
    } catch {
      // RPC error, keep polling
    }
  }
}

function ensureLoaded() {
  if (storeLoaded) {
    return;
  }

  storeLoaded = true;
  loadStore();
}

function loadStore(): void {
  try {
    if (!existsSync(STORE_FILE)) {
      return;
    }
    const raw = readFileSync(STORE_FILE, "utf8");
    const parsed = JSON.parse(raw) as { transactions?: StoredTransaction[] };
    for (const tx of parsed.transactions ?? []) {
      transactions.set(tx.txHash, tx);
      const list = userIndex.get(tx.userAddress) ?? [];
      list.push(tx.txHash);
      userIndex.set(tx.userAddress, list);
    }
  } catch {
    // Missing or malformed store: start fresh.
  }
}

async function persistStore(): Promise<void> {
  const snapshot = JSON.stringify({ transactions: [...transactions.values()] }, null, 2);
  persistChain = persistChain.then(async () => {
    await mkdir(STORE_DIR, { recursive: true });
    await writeFile(STORE_FILE, snapshot, "utf8");
  }).catch(() => {});

  await persistChain;
}
