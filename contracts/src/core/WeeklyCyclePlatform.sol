// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {QueueKind} from "../interfaces/IQueueAdapter.sol";
import {PlatformBase} from "./PlatformBase.sol";
import {PlatformConfig} from "./PlatformConfig.sol";

/// @notice Kasu-style weekly cycle. Unpaid requests roll. A gate blocks new exits and does not freeze settlement.
/// @dev Real Kasu orders by loyalty. This mock is FIFO so tests stay deterministic.
contract WeeklyCyclePlatform is PlatformBase {
    constructor(PlatformConfig memory cfg) PlatformBase(cfg) {}

    /// @notice Weekly cycle. Unpaid requests roll. A closed gate blocks new exits, and settlement still runs.
    function kind() public pure override returns (QueueKind) {
        return QueueKind.WeeklyCycle;
    }
}
