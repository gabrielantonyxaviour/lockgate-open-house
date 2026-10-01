// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {QueueKind} from "../interfaces/IQueueAdapter.sol";
import {PlatformBase} from "./PlatformBase.sol";
import {PlatformConfig} from "./PlatformConfig.sol";

/// @notice Epoch queue. After Lockgate is repaid, queued investors share the remaining cash pro-rata.
///         Dust stays in the platform. A shortfall rolls to the next epoch.
contract EpochQueuePlatform is PlatformBase {
    constructor(PlatformConfig memory cfg) PlatformBase(cfg) {}

    function kind() public pure override returns (QueueKind) {
        return QueueKind.Epoch;
    }

    function _payQueue() internal override {
        _payProRata();
    }
}
