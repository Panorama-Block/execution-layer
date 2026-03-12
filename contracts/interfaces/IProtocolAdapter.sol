// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title IProtocolAdapter
 * @notice Generic interface all protocol adapters must implement.
 * @dev A single execute() entry point dispatches to protocol-specific logic
 *      based on the selector. Data encoding per selector:
 *
 *  SWAP             bytes4(keccak256("swap"))
 *    abi.decode(data, (address tokenIn, address tokenOut, uint256 amountIn,
 *                      uint256 amountOutMin, address recipient, bool stable))
 *
 *  ADD_LIQUIDITY    bytes4(keccak256("addLiquidity"))
 *    abi.decode(data, (address tokenA, address tokenB, bool stable,
 *                      uint256 amountADesired, uint256 amountBDesired,
 *                      uint256 amountAMin, uint256 amountBMin, address recipient))
 *
 *  REMOVE_LIQUIDITY bytes4(keccak256("removeLiquidity"))
 *    abi.decode(data, (address tokenA, address tokenB, bool stable,
 *                      uint256 liquidity, uint256 amountAMin, uint256 amountBMin,
 *                      address recipient, address pool))
 *
 *  STAKE            bytes4(keccak256("stake"))
 *    abi.decode(data, (address lpToken, uint256 amount, address gauge))
 *
 *  UNSTAKE          bytes4(keccak256("unstake"))
 *    abi.decode(data, (address lpToken, uint256 amount, address gauge, address recipient))
 *
 *  CLAIM_REWARDS    bytes4(keccak256("claimRewards"))
 *    abi.decode(data, (address lpToken, address recipient, address gauge))
 */
interface IProtocolAdapter {
    function execute(bytes4 selector, bytes calldata data)
        external payable returns (bytes memory result);
}
