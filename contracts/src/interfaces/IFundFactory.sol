// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {QueueKind} from "./IQueueAdapter.sol";

/// @notice One-click sandbox platforms. `createDemoFund` matches the MVP seed.
interface IFundFactory {
    /// @notice Caller becomes the issuer. Quarterly, and only when the token is MockUSDG. Posts the demo reserve and cash.
    function createDemoFund(string calldata fundName) external returns (address fund);

    /// @notice Anyone, once this factory is a registrar. Posts no cash. `reserveBps` may be 0.
    function createPlatform(
        QueueKind kind,
        string calldata fundName,
        uint64 interval,
        uint256 shareNav,
        uint256 limit,
        uint16 reserveBps
    ) external returns (address fund);

    /// @notice Platforms this issuer created, in creation order.
    function fundsOf(address issuer) external view returns (address[] memory);

    /// @notice Every platform this factory created, in creation order.
    function allFunds() external view returns (address[] memory);

    /// @notice Interval `createDemoFund` writes. The default is 600 seconds.
    function demoWindow() external view returns (uint64);

    /// @notice Owner. Zero reverts. A fund that already exists keeps its interval.
    function setDemoWindow(uint64 interval) external;
}
