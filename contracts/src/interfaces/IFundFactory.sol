// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {QueueKind} from "./IQueueAdapter.sol";

/// @notice One-click sandbox platforms. `createDemoFund` matches the MVP seed.
interface IFundFactory {
    function createDemoFund(string calldata fundName) external returns (address fund);

    function createPlatform(
        QueueKind kind,
        string calldata fundName,
        uint64 interval,
        uint256 shareNav,
        uint256 limit,
        uint16 reserveBps
    ) external returns (address fund);

    function fundsOf(address issuer) external view returns (address[] memory);

    function allFunds() external view returns (address[] memory);

    function demoWindow() external view returns (uint64);

    function setDemoWindow(uint64 interval) external;
}
