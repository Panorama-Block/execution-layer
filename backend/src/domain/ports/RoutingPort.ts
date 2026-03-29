// ──────────────────────────────────────────────────────────────────
// ROUTING PORT
//
// Abstraction for cross-chain route aggregation.
// This is where LI.FI, Socket, or a custom routing engine will plug in.
//
// Differs from CrossChainMessagingPort:
//   - MessagingPort = single protocol adapter (Wormhole, CCIP, etc.)
//   - RoutingPort   = aggregator that queries MULTIPLE messaging ports
//                     and returns the best route across all of them
//
// Pattern reference: bridge-service's BridgeProviderPort.
// ──────────────────────────────────────────────────────────────────

import { CrossChainRoute, MessageStatusResponse } from "../../types/cross-chain";

export interface RoutingPort {
  /**
   * Queries all available messaging adapters and returns ranked routes.
   *
   * @param fromChainId  Source chain ID
   * @param toChainId    Destination chain ID
   * @param token        Token address on source chain
   * @param amount       Amount in wei (string)
   * @returns            Routes from all protocols, sorted best-first
   */
  getRoutes(
    fromChainId: number,
    toChainId: number,
    token: string,
    amount: string,
  ): Promise<CrossChainRoute[]>;

  /**
   * Executes a specific route by delegating to the appropriate
   * CrossChainMessagingPort adapter.
   *
   * @param routeId      Route ID from getRoutes()
   * @param userAddress  Sender's wallet address
   * @returns            Transactions to sign + tracking messageId
   */
  executeRoute(
    routeId: string,
    userAddress: string,
  ): Promise<{
    transactions: Array<{
      to: string;
      data: string;
      value: string;
      chainId: number;
      description: string;
    }>;
    messageId: string;
  }>;

  /**
   * Checks status of a cross-chain transfer.
   *
   * @param messageId  Tracking ID from executeRoute
   */
  getRouteStatus(messageId: string): Promise<MessageStatusResponse>;
}
