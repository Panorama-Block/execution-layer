// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title ISwapAdapter
 * @notice Family marker interface for protocol adapters that expose token-swap actions.
 * @dev This interface is intentionally a marker (no functions) because swap surfaces
 *      diverge between protocol families:
 *
 *        - Solidly-style (Aerodrome, Velodrome): swap has `bool stable` to select
 *          correlated vs volatile pool routing.
 *        - UniswapV2-style (Trader Joe V1): swap takes no `stable` flag and exposes
 *          `swapWithPath(...)` for multi-hop routing.
 *        - Concentrated-liquidity / aggregator styles will introduce yet more shapes.
 *
 *      Enforcing a single strict Solidity signature would force every adapter into one
 *      flavour and break existing deployed V2 contracts. Instead, this marker declares
 *      family membership; the concrete swap selector lives in each adapter and is
 *      registered via the backend `ADAPTER_SELECTORS` map + Protocol Registry.
 *
 *      Expected selectors (registered per adapter, not enforced on-chain):
 *        - `swap(address,address,uint256,uint256,address,bool)`        — Solidly style
 *        - `swap(address,address,uint256,uint256,address)`             — UniV2 style
 *        - `swapWithPath(uint256,uint256,address[],address)`           — UniV2 multi-hop
 *
 *      Events and errors intentionally live on the adapter — declaring them here would
 *      force storage-adjacent changes on already-deployed implementations.
 */
interface ISwapAdapter {
    // Intentionally empty — marker interface.
}
