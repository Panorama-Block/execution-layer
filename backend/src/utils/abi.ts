export const PANORAMA_EXECUTOR_ABI = [
  "function executeSwap(bytes32 protocolId, address tokenIn, address tokenOut, uint256 amountIn, uint256 amountOutMin, bytes calldata extraData, uint256 deadline) external payable returns (uint256 amountOut)",
  "function executeAddLiquidity(bytes32 protocolId, address tokenA, address tokenB, uint256 amountA, uint256 amountB, uint256 minLpAmount, bytes calldata extraData, uint256 deadline) external payable returns (uint256 lpAmount)",
  "function executeRemoveLiquidity(bytes32 protocolId, address tokenA, address tokenB, uint256 lpAmount, uint256 minAmountA, uint256 minAmountB, bytes calldata extraData, uint256 deadline) external payable returns (uint256 amountA, uint256 amountB)",
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
