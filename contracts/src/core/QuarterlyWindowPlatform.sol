// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {QueueKind} from "../interfaces/IQueueAdapter.sol";
import {PlatformBase} from "./PlatformBase.sol";
import {PlatformConfig} from "./PlatformConfig.sol";

/// @notice Quarterly gated window. FIFO like the weekly cycle, but a closed gate also freezes settlement.
///         Lockgate then waits for `markLate` and the first-loss reserve. Ungating lets the window clear.
contract QuarterlyWindowPlatform is PlatformBase {
    constructor(PlatformConfig memory cfg) PlatformBase(cfg) {}

    /// @notice Quarterly window. A closed gate freezes `processWindow`.
    function kind() public pure override returns (QueueKind) {
        return QueueKind.QuarterlyGated;
    }

    /// @notice Reverts `WindowGated` while `gated` is set, then settles like a weekly window.
    function processWindow() external override nonReentrant {
        if (gated) revert WindowGated();
        _process();
    }
}
