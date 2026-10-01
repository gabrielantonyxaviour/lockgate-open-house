// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {QueueKind} from "../interfaces/IQueueAdapter.sol";
import {PlatformBase} from "./PlatformBase.sol";
import {PlatformConfig} from "./PlatformConfig.sol";

/// @notice Quarterly gated window. FIFO like the weekly cycle, but a closed gate also freezes settlement.
///         Lockgate then waits for `markLate` and the first-loss reserve. Ungating lets the window clear.
contract QuarterlyWindowPlatform is PlatformBase {
    constructor(PlatformConfig memory cfg) PlatformBase(cfg) {}

    function kind() public pure override returns (QueueKind) {
        return QueueKind.QuarterlyGated;
    }

    function processWindow() external override nonReentrant {
        if (gated) revert WindowGated();
        _process();
    }
}
