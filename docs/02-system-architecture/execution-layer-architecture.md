# Execution Layer Architecture

## Design Pattern: Thin Executor + Protocol Adapters

The execution layer uses a registry-based delegation pattern. A single PanoramaExecutor contract serves as the user-facing entry point. It maintains a mapping of protocol identifiers (bytes32) to adapter contract addresses. When an operation is called, the executor looks up the appropriate adapter and delegates the protocol-specific logic.

### Why Not Call Aerodrome Directly from Frontend

1. **Audit surface**: A single executor contract provides one point of review for all operations.
2. **Fee collection**: Future fee logic can be added in the executor without modifying adapters.
3. **Composability**: Multi-step operations (approve + swap + stake) can be composed.
4. **Event standardization**: Consistent event emission for indexing and analytics.
5. **Ecosystem attribution**: On-chain activity flows through Panorama contracts, creating measurable ecosystem value.

## Contract Hierarchy

```
PanoramaExecutor.sol (Core)
  |
  +-- Adapter Registry (mapping bytes32 => address)
  |     |
  |     +-- keccak256("aerodrome") => AerodromeAdapter
  |     +-- keccak256("moonwell") => MoonwellAdapter (future)
  |     +-- keccak256("velodrome") => VelodromeAdapter (future)
  |
  +-- IProtocolAdapter.sol (Interface)
        |
        +-- AerodromeAdapter.sol (Implementation)
        +-- Future adapters...
```

## Token Flow

### Swap (ERC20 -> ERC20)
1. User approves PanoramaExecutor to spend tokenIn
2. User calls executor.executeSwap()
3. Executor calls tokenIn.safeTransferFrom(user, adapter, amount)
4. Adapter approves protocol router
5. Adapter calls router.swapExactTokensForTokens(..., user, ...)
6. Output tokens sent directly to user by the protocol

### Swap (ETH -> ERC20)
1. User calls executor.executeSwap{value: amount}()
2. Executor forwards msg.value to adapter.swap{value: amount}()
3. Adapter calls router.swapExactETHForTokens(..., user, ...)
4. Output tokens sent directly to user

### Add Liquidity
1. User approves executor for both tokenA and tokenB
2. User calls executor.executeAddLiquidity()
3. Executor transfers both tokens to adapter
4. Adapter approves router, calls router.addLiquidity()
5. LP tokens sent to user, unused tokens refunded to user

## Security Model

- **ReentrancyGuard**: Custom implementation on all external functions (gas-efficient, no OpenZeppelin dependency)
- **Deadline enforcement**: All execute functions accept a deadline parameter, revert if block.timestamp > deadline
- **Slippage protection**: amountOutMin/amountAMin/amountBMin enforced by both executor and protocol
- **No token custody**: Executor and adapter do not hold tokens between transactions
- **Access control**: onlyOwner for registerAdapter, removeAdapter, emergencyWithdraw
- **Emergency recovery**: emergencyWithdraw() and emergencyWithdrawERC20() for stuck funds
- **Adapter isolation**: Only the executor can call adapter functions (onlyExecutor modifier)

## Event Emission

All operations emit events for indexing:
- SwapExecuted(user, protocolId, tokenIn, tokenOut, amountIn, amountOut)
- LiquidityAdded(user, protocolId, tokenA, tokenB, stable, liquidity)
- LiquidityRemoved(user, protocolId, tokenA, tokenB, stable, amountA, amountB)
- StakeExecuted(user, protocolId, lpToken, amount)
- UnstakeExecuted(user, protocolId, lpToken, amount)

## Upgrade Strategy

The executor itself is not upgradeable (no proxy pattern, keeping it simple for MVP). To update protocol interactions:

1. Deploy a new adapter contract
2. Call executor.registerAdapter(protocolId, newAdapterAddress)
3. Old adapter is replaced, new one takes effect immediately

To add a new protocol:
1. Implement IProtocolAdapter for the new protocol
2. Deploy the adapter
3. Register with a new protocolId

The executor contract only changes if the interface itself needs modification, which would require a new deployment.
