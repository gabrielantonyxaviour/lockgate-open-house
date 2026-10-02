// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ILockgateCreditLine} from "../interfaces/ILockgateCreditLine.sol";
import {IReceivablesBook} from "./interfaces/IReceivablesBook.sol";

/// @title CreditLineBook
/// @notice Read-only adapter from Lockgate's own credit line into the facility borrowing base.
///         Point this at the stage-1 line, never at a partner vault.
contract CreditLineBook is IReceivablesBook {
    address public immutable line;

    error ZeroAddress();

    constructor(address line_) {
        if (line_ == address(0)) revert ZeroAddress();
        line = line_;
    }

    /// @notice Performing exposure on the stage-1 credit line.
    function eligibleOutstanding() external view returns (uint256) {
        return ILockgateCreditLine(line).eligibleOutstanding();
    }

    /// @notice Past-due exposure on the stage-1 credit line.
    function lateOutstanding() external view returns (uint256) {
        return ILockgateCreditLine(line).lateOutstanding();
    }
}
