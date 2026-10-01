// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @notice Exact-amount USDG moves. A fee-on-transfer token cannot satisfy the balance check.
library UsdgTransfers {
    using SafeERC20 for IERC20;

    error FeeOnTransfer(uint256 expected, uint256 received);

    function pull(address token, address from, address to, uint256 amount) internal {
        if (amount == 0) return;
        uint256 beforeBal = IERC20(token).balanceOf(to);
        IERC20(token).safeTransferFrom(from, to, amount);
        uint256 received = IERC20(token).balanceOf(to) - beforeBal;
        if (received != amount) revert FeeOnTransfer(amount, received);
    }

    function push(address token, address to, uint256 amount) internal {
        if (amount == 0) return;
        IERC20(token).safeTransfer(to, amount);
    }
}
