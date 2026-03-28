// ──────────────────────────────────────────────────────────────────
// CROSS-CHAIN MESSAGING PORT
//
// Abstract interface for cross-chain message passing.
// Following the hexagonal architecture pattern from bridge-service's
// BridgeProviderPort — the domain defines WHAT it needs, and
// infrastructure adapters implement HOW.
//
// Future implementations:
//   - WormholeAdapter    (Wormhole NTT / Token Bridge)
//   - CCIPAdapter        (Chainlink CCIP)
//   - LayerZeroAdapter   (LayerZero V2)
//   - LiFiAdapter        (LI.FI aggregator — wraps multiple bridges)
//
// The Executor contract triggers cross-chain operations via a new
// adapter selector (CROSS_CHAIN_SEND). The backend prepares the
// transaction bundle with the appropriate messaging protocol's calldata.
//
// ────────────────────────────────────────────────────────────
// INTEGRATION POINT WITH EXECUTOR
//
// The PanoramaExecutor will call:
//   adapter.crossChainSend(destChainId, payload, refundAddress)
//
// The adapter encodes this into the messaging protocol's native
// send function (e.g. Wormhole's transferTokens, CCIP's ccipSend).
// ──────────────────────────────────────────────────────────────────

import {
  CrossChainRoute,
  ExecuteRouteRequest,
  ExecuteRouteResult,
  MessageStatusResponse,
  CrossChainFee,
  MessagingProtocol,
} from "../../types/cross-chain";

export interface CrossChainMessagingPort {
  /** Which messaging protocol this adapter implements. */
  readonly protocol: MessagingProtocol;

  /** Which chain pairs this adapter supports (sourceChainId → destChainId[]). */
  readonly supportedRoutes: ReadonlyMap<number, readonly number[]>;

  /**
   * Returns available routes for a cross-chain transfer.
   *
   * @param sourceChainId  Source chain (e.g. 8453 = Base)
   * @param destChainId    Destination chain (e.g. 43114 = Avalanche)
   * @param token          Token address on source chain
   * @param amount         Amount in wei (string)
   * @returns              Array of route options, sorted by estimated output (best first)
   */
  getRoutes(
    sourceChainId: number,
    destChainId: number,
    token: string,
    amount: string,
  ): Promise<CrossChainRoute[]>;

  /**
   * Estimates the fee for a cross-chain transfer without committing.
   * Lighter than getRoutes() — no route computation, just fee estimation.
   *
   * @param sourceChainId  Source chain
   * @param destChainId    Destination chain
   * @param token          Token address on source chain
   * @param amount         Amount in wei (string)
   */
  estimateFee(
    sourceChainId: number,
    destChainId: number,
    token: string,
    amount: string,
  ): Promise<CrossChainFee>;

  /**
   * Prepares transaction(s) for a previously quoted route.
   * Returns unsigned transactions for the user to sign.
   *
   * @param request  Route ID from getRoutes() + user addresses
   * @returns        Transactions to sign + a messageId for tracking
   */
  executeRoute(request: ExecuteRouteRequest): Promise<ExecuteRouteResult>;

  /**
   * Checks the status of an in-flight cross-chain message.
   *
   * @param messageId  Tracking ID from executeRoute()
   * @returns          Current status with source/dest tx hashes when available
   */
  getMessageStatus(messageId: string): Promise<MessageStatusResponse>;
}
