// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title SafeTransferLib
 * @notice Safe ERC20 transfer utilities that handle non-standard return values.
 * @dev Some tokens (e.g., USDT) do not return a bool on transfer/approve.
 *      This library handles both standard and non-standard ERC20 implementations.
 */
library SafeTransferLib {
    error TransferFailed();
    error TransferFromFailed();
    error ApproveFailed();

    function safeTransfer(address token, address to, uint256 amount) internal {
        (bool success, bytes memory data) = token.call(abi.encodeWithSelector(0xa9059cbb, to, amount));
        if (!success || (data.length > 0 && !abi.decode(data, (bool)))) revert TransferFailed();
    }

    function safeTransferFrom(address token, address from, address to, uint256 amount) internal {
        (bool success, bytes memory data) = token.call(abi.encodeWithSelector(0x23b872dd, from, to, amount));
        if (!success || (data.length > 0 && !abi.decode(data, (bool)))) revert TransferFromFailed();
    }

    function safeApprove(address token, address spender, uint256 amount) internal {
        (bool success, bytes memory data) = token.call(abi.encodeWithSelector(0x095ea7b3, spender, amount));
        if (!success || (data.length > 0 && !abi.decode(data, (bool)))) revert ApproveFailed();
    }

    function safeTransferETH(address to, uint256 amount) internal {
        (bool success,) = to.call{value: amount}("");
        if (!success) revert TransferFailed();
    }
}
