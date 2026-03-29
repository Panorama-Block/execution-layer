// ──────────────────────────────────────────────────────────────────
// WALLET SEPARATION MODEL
//
// Documents and enforces the distinct wallet roles in the system.
// Each role has different trust levels and transaction limits.
//
// Architecture:
//   ┌──────────────┐     ┌───────────────────┐     ┌──────────────┐
//   │  User Wallet  │────▶│  PanoramaExecutor  │────▶│  UserAdapter │
//   │  (signs tx)   │     │  (dispatcher)      │     │  (per-user)  │
//   └──────────────┘     └───────────────────┘     └──────────────┘
//                                                         │
//                                                    ┌────▼────┐
//                                                    │ Protocol │
//                                                    │ (Aero,   │
//                                                    │  Benqi)  │
//                                                    └─────────┘
//
// NON-CUSTODIAL: The backend NEVER holds private keys.
// All transactions are prepared unsigned and signed by the user's wallet.
// ──────────────────────────────────────────────────────────────────

/** Wallet roles in the PanoramaBlock execution system. */
export enum WalletRole {
  /** User's own wallet (MetaMask, ThirdWeb in-app). Signs all transactions. */
  USER = "USER",

  /**
   * Per-user BeaconProxy clone created by PanoramaExecutor.
   * Holds LP tokens, gauge stakes, and protocol positions on behalf of the user.
   * Only the user (via Executor) can interact with their adapter.
   */
  USER_ADAPTER = "USER_ADAPTER",

  /**
   * DCA execution wallet (backend-controlled signer).
   * Used ONLY for automated DCA swap execution via DCAVault.
   * Has strict per-transaction and per-session limits.
   */
  DCA_EXECUTOR = "DCA_EXECUTOR",

  /**
   * Fee collection treasury (multisig or DAO-controlled).
   * Receives protocol fees from adapter operations.
   * NOT used in the current execution-layer — reserved for future use.
   */
  TREASURY = "TREASURY",
}

// ── Per-Transaction Limits ────────────────────────────────────────
// These apply to the DCA_EXECUTOR role only.
// User-initiated transactions have no backend-enforced limit
// (the user controls their own wallet).

export const EXECUTION_LIMITS = {
  /** Max value per single DCA swap execution (in wei). ~0.5 ETH */
  MAX_SINGLE_TX_VALUE: BigInt("500000000000000000"),

  /** Max cumulative value per DCA session/epoch (in wei). ~5 ETH */
  MAX_SESSION_VALUE: BigInt("5000000000000000000"),

  /** Max number of DCA executions per session. */
  MAX_EXECUTIONS_PER_SESSION: 50,

  /** Session duration in milliseconds (1 hour). */
  SESSION_DURATION_MS: 60 * 60 * 1000,
} as const;

// ── Audit Log Entry ───────────────────────────────────────────────
// Every DCA execution action should be logged with this shape
// for post-hoc audit trail.

export interface ExecutionAuditEntry {
  timestamp: number;
  walletRole: WalletRole;
  action: string;
  protocol: string;
  chain: string;
  userAddress: string;
  adapterAddress?: string;
  amountWei: string;
  txHash?: string;
  orderId?: number;
  success: boolean;
  error?: string;
}
