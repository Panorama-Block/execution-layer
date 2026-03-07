export const PANORAMA_EXECUTOR_ABI = [
  "function executeSwap(bytes32 protocolId, address tokenIn, address tokenOut, uint256 amountIn, uint256 amountOutMin, bytes calldata extraData, uint256 deadline) external payable returns (uint256 amountOut)",
  "function executeAddLiquidity(bytes32 protocolId, address tokenA, address tokenB, bool stable, uint256 amountADesired, uint256 amountBDesired, uint256 amountAMin, uint256 amountBMin, bytes calldata extraData, uint256 deadline) external payable returns (uint256 liquidity)",
  "function executeRemoveLiquidity(bytes32 protocolId, address tokenA, address tokenB, bool stable, uint256 liquidity, uint256 amountAMin, uint256 amountBMin, bytes calldata extraData, uint256 deadline) external returns (uint256 amountA, uint256 amountB)",
  "function executeStake(bytes32 protocolId, address lpToken, uint256 amount, bytes calldata extraData) external",
  "function executeUnstake(bytes32 protocolId, address lpToken, uint256 amount, bytes calldata extraData) external",
  "function adapters(bytes32) external view returns (address)",
] as const;

export const AERODROME_ROUTER_ABI = [
  "function getAmountsOut(uint256 amountIn, (address from, address to, bool stable, address factory)[] routes) external view returns (uint256[] amounts)",
  "function poolFor(address tokenA, address tokenB, bool stable, address factory) external view returns (address pool)",
] as const;

export const AERODROME_FACTORY_ABI = [
  "function getPool(address tokenA, address tokenB, bool stable) external view returns (address pool)",
  "function allPoolsLength() external view returns (uint256)",
  "function allPools(uint256) external view returns (address)",
] as const;

export const ERC20_ABI = [
  "function balanceOf(address) external view returns (uint256)",
  "function decimals() external view returns (uint8)",
  "function symbol() external view returns (string)",
  "function allowance(address owner, address spender) external view returns (uint256)",
  "function approve(address spender, uint256 amount) external returns (bool)",
] as const;

export const POOL_ABI = [
  "function token0() external view returns (address)",
  "function token1() external view returns (address)",
  "function stable() external view returns (bool)",
  "function getReserves() external view returns (uint256, uint256, uint256)",
] as const;

export const GAUGE_ABI = [
  "function deposit(uint256 amount) external",
  "function deposit(uint256 amount, address recipient) external",
  "function withdraw(uint256 amount) external",
  "function balanceOf(address account) external view returns (uint256)",
  "function earned(address account) external view returns (uint256)",
  "function getReward(address account) external",
  "function rewardRate() external view returns (uint256)",
  "function rewardToken() external view returns (address)",
  "function totalSupply() external view returns (uint256)",
  "function stakingToken() external view returns (address)",
] as const;

export const VOTER_ABI = [
  "function gauges(address pool) external view returns (address)",
  "function isGauge(address gauge) external view returns (bool)",
  "function isAlive(address gauge) external view returns (bool)",
] as const;

export const DCA_VAULT_ABI = [
  "function createOrder(address tokenIn, address tokenOut, uint256 amountPerSwap, uint256 interval, uint256 remainingSwaps, bool stable, uint256 depositAmount) external returns (uint256 orderId)",
  "function deposit(uint256 orderId, uint256 amount) external",
  "function cancel(uint256 orderId) external",
  "function withdraw(uint256 orderId) external",
  "function execute(uint256 orderId, uint256 amountOutMin, bytes calldata extraData, uint256 deadline) external",
  "function getUserOrders(address user) external view returns (uint256[])",
  "function getOrder(uint256 orderId) external view returns (tuple(address owner, address tokenIn, address tokenOut, uint256 amountPerSwap, uint256 interval, uint256 lastExecuted, uint256 remainingSwaps, uint256 balance, bool stable, bool active))",
  "function isExecutable(uint256 orderId) external view returns (bool)",
  "function nextExecutionAt(uint256 orderId) external view returns (uint256)",
  "function orders(uint256) external view returns (address owner, address tokenIn, address tokenOut, uint256 amountPerSwap, uint256 interval, uint256 lastExecuted, uint256 remainingSwaps, uint256 balance, bool stable, bool active)",
] as const;
