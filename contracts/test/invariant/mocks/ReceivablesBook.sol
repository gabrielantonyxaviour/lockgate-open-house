// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IReceivablesBook} from "../../../src/facility/interfaces/IReceivablesBook.sol";

/// @notice Test borrowing base. The stage-1 credit line does not expose these views.
contract ReceivablesBook is IReceivablesBook {
    uint256 public eligible;
    uint256 public late;

    function set(uint256 eligible_, uint256 late_) external {
        eligible = eligible_;
        late = late_;
    }

    function eligibleOutstanding() external view returns (uint256) {
        return eligible;
    }

    function lateOutstanding() external view returns (uint256) {
        return late;
    }
}
