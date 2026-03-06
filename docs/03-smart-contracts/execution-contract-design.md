# Execution Contract Design

## PanoramaExecutor.sol

### State Variables
- `address public owner` - Contract owner (deployer)
- `mapping(bytes32 => address) public adapters` - Protocol ID to adapter address registry
- `bool private _locked` - Reentrancy guard flag

### Events
- `AdapterRegistered(bytes32 indexed protocolId, address indexed adapter)`
- `AdapterRemoved(bytes32 indexed protocolId, address indexed oldAdapter)`
- `SwapExecuted(address indexed user, bytes32 indexed protocolId, address tokenIn, address tokenOut, uint256 amountIn, uint256 amountOut)`
- `LiquidityAdded(address indexed user, bytes32 indexed protocolId, address tokenA, address tokenB, bool stable, uint256 liquidity)`
- `LiquidityRemoved(address indexed user, bytes32 indexed protocolId, address tokenA, address tokenB, bool stable, uint256 amountA, uint256 amountB)`
- `StakeExecuted(address indexed user, bytes32 indexed protocolId, address lpToken, uint256 amount)`
- `UnstakeExecuted(address indexed user, bytes32 indexed protocolId, address lpToken, uint256 amount)`

### Custom Errors
- `Unauthorized()` - Caller is not owner
- `AdapterNotRegistered()` - No adapter for the given protocolId
- `DeadlineExpired()` - block.timestamp > deadline
- `InvalidAmount()` - Zero amount provided
- `InsufficientOutput()` - Output less than minimum
- `TransferFailed()` - ETH transfer failed
- `Reentrancy()` - Reentrant call detected
- `ZeroAddress()` - Zero address provided

### Functions

#### executeSwap
```solidity
function executeSwap(
    bytes32 protocolId,
    address tokenIn,      // address(0) for native ETH
    address tokenOut,
    uint256 amountIn,
    uint256 amountOutMin, // slippage protection
    bytes calldata extraData, // protocol-specific (e.g., pool type)
    uint256 deadline
) external payable nonReentrant beforeDeadline(deadline) returns (uint256 amountOut)
```

#### executeAddLiquidity
```solidity
function executeAddLiquidity(
    bytes32 protocolId,
    address tokenA,
    address tokenB,
    bool stable,
    uint256 amountADesired,
    uint256 amountBDesired,
    uint256 amountAMin,
    uint256 amountBMin,
    bytes calldata extraData,
    uint256 deadline
) external payable nonReentrant beforeDeadline(deadline) returns (uint256 liquidity)
```

#### executeRemoveLiquidity
```solidity
function executeRemoveLiquidity(
    bytes32 protocolId,
    address tokenA,
    address tokenB,
    bool stable,
    uint256 liquidity,
    uint256 amountAMin,
    uint256 amountBMin,
    bytes calldata extraData, // encodes pool/LP token address
    uint256 deadline
) external nonReentrant beforeDeadline(deadline) returns (uint256 amountA, uint256 amountB)
```

#### executeStake / executeUnstake
```solidity
function executeStake(bytes32 protocolId, address lpToken, uint256 amount, bytes calldata extraData) external nonReentrant
function executeUnstake(bytes32 protocolId, address lpToken, uint256 amount, bytes calldata extraData) external nonReentrant
```

#### Admin Functions
```solidity
function registerAdapter(bytes32 protocolId, address adapter) external onlyOwner
function removeAdapter(bytes32 protocolId) external onlyOwner
function transferOwnership(address newOwner) external onlyOwner
function emergencyWithdraw() external onlyOwner
function emergencyWithdrawERC20(address token) external onlyOwner
```

## IProtocolAdapter.sol

Generic interface that all protocol adapters must implement. Each function mirrors the executor's operations but with `recipient` instead of `msg.sender`.

## SafeTransferLib.sol

Handles non-standard ERC20 tokens (e.g., USDT that does not return bool):
- `safeTransfer(token, to, amount)` - Low-level call with return value check
- `safeTransferFrom(token, from, to, amount)` - Same for transferFrom
- `safeApprove(token, spender, amount)` - Same for approve
- `safeTransferETH(to, amount)` - Native ETH transfer with success check

## Design Decisions

**Why custom ReentrancyGuard?** Gas-efficient, avoids OpenZeppelin dependency for a single bool flag.

**Why bytes32 for protocolId?** Compact, deterministic (keccak256 of protocol name), efficient for mapping lookups. Example: `keccak256("aerodrome")`.

**Why extraData parameter?** Each protocol has unique requirements (pool type, route, gauge address). extraData provides flexibility without changing the interface. Adapters decode what they need.

**Why no proxy/upgradeable pattern?** Simplicity for MVP. Adapters can be swapped via registerAdapter. A new executor deployment is straightforward if needed.

**Comparison with ValidatedLending.sol:** Same owner model, emergency withdraw pattern, custom errors, event emission. The executor generalizes this pattern from Benqi-specific to any protocol via the adapter registry.
