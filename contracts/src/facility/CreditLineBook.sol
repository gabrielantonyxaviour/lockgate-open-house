// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IReceivablesBook} from "./interfaces/IReceivablesBook.sol";

/// @title ILockgateCreditLineBook
/// @notice Views G7 asks G6 to expose on the stage-1 credit line.
interface ILockgateCreditLineBook {
    function eligibleOutstanding() external view returns (uint256);
    function lateOutstanding() external view returns (uint256);
}

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

    function eligibleOutstanding() external view returns (uint256) {
        return ILockgateCreditLineBook(line).eligibleOutstanding();
    }

    function lateOutstanding() external view returns (uint256) {
        return ILockgateCreditLineBook(line).lateOutstanding();
    }
}
