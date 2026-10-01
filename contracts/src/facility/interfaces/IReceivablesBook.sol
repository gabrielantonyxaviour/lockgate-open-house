// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Lockgate's own book of advances. Partner-vault receivables are not a borrowing base.
/// @dev G6's credit line should expose both views. `eligibleOutstanding` is performing exposure.
///      `lateOutstanding` is past due and does not support new draws.
interface IReceivablesBook {
    function eligibleOutstanding() external view returns (uint256);
    function lateOutstanding() external view returns (uint256);
}
