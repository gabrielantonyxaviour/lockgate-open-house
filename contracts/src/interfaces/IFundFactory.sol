// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {QueueKind} from "./IQueueAdapter.sol";

/// @notice One-click sandbox platforms. `createDemoFund` matches the MVP seed.
interface IFundFactory {
    /// @notice Owner only. `issuer` runs the fund. Quarterly, and only when the token is MockUSDG. Posts the demo
    ///         reserve and cash.
    function createDemoFund(string calldata fundName, address issuer) external returns (address fund);

    /// @notice Owner only (Lockgate), so the limit and reserve rate registered on the line are Lockgate's. `issuer`
    ///         runs the fund. Posts no cash.
    function createPlatform(
        QueueKind kind,
        string calldata fundName,
        uint64 interval,
        uint256 shareNav,
        address issuer,
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
