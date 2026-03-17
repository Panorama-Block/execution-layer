export const PANORAMA_EXECUTOR_ABI = [
  "function execute(bytes32 protocolId, bytes4 selector, (address token, uint256 amount)[] transfers, uint256 deadline, bytes data) external payable returns (bytes result)",
  "function executeSwapFor(address user, bytes32 protocolId, bytes4 selector, (address token, uint256 amount)[] transfers, uint256 deadline, bytes data) external payable returns (bytes result)",
  "function adapterImplementations(bytes32) external view returns (address)",
  "function getUserAdapter(bytes32 protocolId, address user) external view returns (address)",
  "function predictUserAdapter(bytes32 protocolId, address user) external view returns (address)",
  "function userAdapters(bytes32, address) external view returns (address)",
] as const;

export const AERODROME_ROUTER_ABI = [
  "function getAmountsOut(uint256 amountIn, (address from, address to, bool stable, address factory)[] routes) external view returns (uint256[] amounts)",
  "function poolFor(address tokenA, address tokenB, bool stable, address factory) external view returns (address pool)",
  "function quoteAddLiquidity(address tokenA, address tokenB, bool stable, address factory, uint256 amountADesired, uint256 amountBDesired) external view returns (uint256 amountA, uint256 amountB, uint256 liquidity)",
] as const;

export const AERODROME_FACTORY_ABI = [
  "function getPool(address tokenA, address tokenB, bool stable) external view returns (address pool)",
  "function allPoolsLength() external view returns (uint256)",
  "function allPools(uint256) external view returns (address)",
] as const;

export const ERC20_ABI = [
  "function balanceOf(address) external view returns (uint256)",
  "function totalSupply() external view returns (uint256)",
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

export const TRADER_JOE_ROUTER_ABI = [
  "function swapExactTokensForTokens(uint256 amountIn, uint256 amountOutMin, address[] path, address to, uint256 deadline) external returns (uint256[] amounts)",
  "function swapExactAVAXForTokens(uint256 amountOutMin, address[] path, address to, uint256 deadline) external payable returns (uint256[] amounts)",
  "function swapExactTokensForAVAX(uint256 amountIn, uint256 amountOutMinAVAX, address[] path, address to, uint256 deadline) external returns (uint256[] amounts)",
  "function getAmountsOut(uint256 amountIn, address[] path) external view returns (uint256[] amounts)",
  "function WAVAX() external pure returns (address)",
] as const;

export const PANORAMA_SWAP_ABI = [
  "function swapTokensForTokens(uint256 amountIn, uint256 amountOutMin, address[] path, uint256 deadline) external returns (uint256 amountOut)",
  "function swapAVAXForTokens(uint256 amountOutMin, address[] path, uint256 deadline) external payable returns (uint256 amountOut)",
  "function swapTokensForAVAX(uint256 amountIn, uint256 amountOutMin, address[] path, uint256 deadline) external returns (uint256 amountOut)",
  "function getAmountsOut(uint256 amountIn, address[] path) external view returns (uint256[] amounts)",
  "function router() external view returns (address)",
  "function WAVAX() external view returns (address)",
] as const;

export const PANORAMA_LIQUID_STAKING_ABI = [
  "function stake() external payable returns (uint256 sAvaxReceived)",
  "function requestUnlock(uint256 sAvaxAmount) external returns (uint256 userUnlockIndex)",
  "function redeem(uint256 userUnlockIndex) external",
  "function previewStake(uint256 avaxAmount) external view returns (uint256)",
  "function previewRedeem(uint256 sAvaxAmount) external view returns (uint256)",
  "function exchangeRate() external view returns (uint256)",
  "function getUnlockRequestCount(address user) external view returns (uint256)",
  "function getUnlockRequest(address user, uint256 userUnlockIndex) external view returns (tuple(uint256 shareAmount, uint256 unlockTime))",
  "function sAvax() external view returns (address)",
] as const;

export const PANORAMA_LEND_ABI = [
  // ERC20 operations
  "function supply(address qToken, uint256 amount) external",
  "function redeem(address qToken, uint256 qTokenAmount) external",
  "function borrow(address qToken, uint256 amount) external",
  "function repay(address qToken, uint256 amount) external",
  // Native AVAX operations
  "function supplyAVAX() external payable",
  "function redeemAVAX(uint256 qTokenAmount) external",
  "function borrowAVAX(uint256 amount) external",
  "function repayAVAX() external payable",
  // Views
  "function comptroller() external view returns (address)",
  "function qiAVAX() external view returns (address)",
] as const;

export const BENQI_TOKEN_ABI = [
  "function mint(uint256 mintAmount) external returns (uint256)",
  "function redeem(uint256 redeemTokens) external returns (uint256)",
  "function borrow(uint256 borrowAmount) external returns (uint256)",
  "function repayBorrow(uint256 repayAmount) external returns (uint256)",
  "function underlying() external view returns (address)",
  "function balanceOf(address owner) external view returns (uint256)",
  "function borrowBalanceStored(address account) external view returns (uint256)",
  "function exchangeRateCurrent() external returns (uint256)",
  "function exchangeRateStored() external view returns (uint256)",
  "function supplyRatePerTimestamp() external view returns (uint256)",
  "function borrowRatePerTimestamp() external view returns (uint256)",
] as const;

export const DCA_VAULT_ABI = [
  // Order management
  "function createOrder(address tokenIn, address tokenOut, uint256 amountPerSwap, uint256 interval, uint256 remainingSwaps, bool stable, uint256 depositAmount) external returns (uint256 orderId)",
  "function deposit(uint256 orderId, uint256 amount) external",
  "function cancel(uint256 orderId) external",
  "function withdraw(uint256 orderId) external",
  "function execute(uint256 orderId, uint256 amountOutMin, bytes calldata extraData, uint256 deadline) external",
  // Views
  "function getUserOrders(address user) external view returns (uint256[])",
  "function getOrder(uint256 orderId) external view returns (tuple(address owner, address tokenIn, address tokenOut, uint256 amountPerSwap, uint256 interval, uint256 lastExecuted, uint256 remainingSwaps, uint256 balance, bool stable, bool active))",
  "function isExecutable(uint256 orderId) external view returns (bool)",
  "function nextExecutionAt(uint256 orderId) external view returns (uint256)",
  "function orders(uint256) external view returns (address owner, address tokenIn, address tokenOut, uint256 amountPerSwap, uint256 interval, uint256 lastExecuted, uint256 remainingSwaps, uint256 balance, bool stable, bool active)",
  // Two-step admin
  "function proposeKeeper(address newKeeper) external",
  "function acceptKeeper() external",
  "function proposeExecutor(address newExecutor) external",
  "function acceptExecutor() external",
  "function proposeOwner(address newOwner) external",
  "function acceptOwnership() external",
  // State
  "function keeper() external view returns (address)",
  "function executor() external view returns (address)",
  "function owner() external view returns (address)",
  "function pendingKeeper() external view returns (address)",
  "function pendingExecutor() external view returns (address)",
  "function pendingOwner() external view returns (address)",
] as const;
