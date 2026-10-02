// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {QueueKind} from "../interfaces/IQueueAdapter.sol";
import {PlatformBase} from "./PlatformBase.sol";
import {PlatformConfig} from "./PlatformConfig.sol";

/// @notice Epoch queue. After Lockgate is repaid, queued investors share the remaining cash pro-rata.
///         Dust stays in the platform. A shortfall rolls to the next epoch.
contract EpochQueuePlatform is PlatformBase {
    constructor(PlatformConfig memory cfg) PlatformBase(cfg) {}

    /// @notice Epoch queue. After Lockgate is repaid, queued investors share the remaining cash pro-rata.
    function kind() public pure override returns (QueueKind) {
        return QueueKind.Epoch;
    }

    function _payQueue() internal override {
        _payProRata();
    }

    /// @dev Same floors as `_payProRata`. A slice that burns no shares adds nothing. A full cover pays the queue.
    function _previewPayable(uint256 room) internal view override returns (uint256 pay) {
        uint256 total = queuedValue;
        if (room >= total) return total;
        for (uint256 id = firstOpen; id != 0; id = nextOpen[id]) {
            if (_requests[id].status != RequestStatus.Queued) continue;
            uint256 navValue = _requests[id].navValue;
            uint256 amount = navValue * room / total;
            if (amount == 0 || navValue == 0) continue;
            uint256 sharesOut = amount == navValue ? _requests[id].shares : _requests[id].shares * amount / navValue;
            if (sharesOut == 0) continue;
            pay += amount;
        }
    }
}
