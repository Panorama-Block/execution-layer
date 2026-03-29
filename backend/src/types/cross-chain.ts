// ──────────────────────────────────────────────────────────────────
// CROSS-CHAIN MESSAGING TYPES
//
// Shared types for cross-chain operations. Used by the
// CrossChainMessagingPort interface and its future implementations
// (Wormhole, CCIP, LayerZero, LI.FI).
// ──────────────────────────────────────────────────────────────────

/** Supported cross-chain messaging protocols. */
export type MessagingProtocol = "wormhole" | "ccip" | "layerzero" | "lifi";

/** Status of a cross-chain message in flight. */
export type MessageStatus =
  | "pending"       // Submitted to source chain, not yet relayed
  | "confirming"    // Source chain confirmed, waiting for relay
  | "relayed"       // Message delivered to destination chain
  | "executed"      // Destination chain execution complete
  | "failed"        // Relay or execution failed
  | "refunded";     // Failed and funds returned to sender

/** Fee breakdown for a cross-chain operation. */
export interface CrossChainFee {
  /** Total fee in source chain native token (wei). */
  totalNative: string;
  /** Protocol relay fee (wei). */
  relayFee: string;
  /** Destination chain gas estimate (wei). */
  destinationGas: string;
  /** Fee in USD (approximate, for display). */
  totalUsd?: string;
}

/** Describes a cross-chain route option returned by getRoutes(). */
export interface CrossChainRoute {
  /** Unique identifier for this route (used in executeRoute). */
  routeId: string;
  /** Which messaging protocol this route uses. */
  protocol: MessagingProtocol;
  /** Source chain ID (e.g. 8453 for Base). */
  sourceChainId: number;
  /** Destination chain ID (e.g. 43114 for Avalanche). */
  destChainId: number;
  /** Token being sent. */
  sourceToken: string;
  /** Token received on destination. */
  destToken: string;
  /** Amount being sent (wei string). */
  amountIn: string;
  /** Estimated amount received (wei string, after fees). */
  estimatedAmountOut: string;
  /** Fee breakdown. */
  fee: CrossChainFee;
  /** Estimated delivery time in seconds. */
  estimatedDurationSec: number;
  /** Number of transaction steps the user must sign. */
  stepCount: number;
}

/** Payload for executing a previously quoted route. */
export interface ExecuteRouteRequest {
  routeId: string;
  userAddress: string;
  /** Optional: override recipient on destination chain. */
  recipientAddress?: string;
}

/** Result of executing a route — returns transaction(s) to sign. */
export interface ExecuteRouteResult {
  /** Source chain transaction(s) for the user to sign. */
  transactions: Array<{
    to: string;
    data: string;
    value: string;
    chainId: number;
    description: string;
  }>;
  /** Tracking ID for getMessageStatus(). */
  messageId: string;
}

/** Status response for a cross-chain message in flight. */
export interface MessageStatusResponse {
  messageId: string;
  status: MessageStatus;
  protocol: MessagingProtocol;
  sourceChainId: number;
  destChainId: number;
  /** Source chain transaction hash (if submitted). */
  sourceTxHash?: string;
  /** Destination chain transaction hash (if executed). */
  destTxHash?: string;
  /** Timestamp when message was sent. */
  sentAt?: number;
  /** Timestamp when message was delivered/executed. */
  completedAt?: number;
  /** Error message if status is "failed". */
  error?: string;
}
