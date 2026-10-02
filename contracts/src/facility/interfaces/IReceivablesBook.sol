// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Lockgate's own book of advances. Partner-vault receivables are not a borrowing base.
/// @dev These selectors match `ILockgateCreditLine`. `eligibleOutstanding` is performing exposure.
///      `lateOutstanding` is past due and does not support new draws.
interface IReceivablesBook {
    /// @notice Performing exposure. A new draw is sized against this.
    function eligibleOutstanding() external view returns (uint256);

    /// @notice Past-due exposure. It does not support a new draw.
    function lateOutstanding() external view returns (uint256);
}
