// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ICreditSource} from "./ICreditSource.sol";

/// @custom:status NOT DEPLOYED, SUPERSEDED (door 2 moves investor positions). Kept only for existing unit tests.
/// @notice Door 2. Lockgate buys open-token shares, pays the seller `nav - fee`, and queues the vault withdrawal.
///         `settle` claims that withdrawal and repays the credit line. Reserve on this source is 0.
interface ILockgateExitPool is ICreditSource {
    struct Position {
        address seller;
        uint256 shares;
        uint256 navValue;
        uint256 fee;
        uint256 withdrawalId;
        uint256 advanceId;
        uint64 readyAt;
        bool settled;
    }

    /// @notice Prices `shares` against the vault nav and the credit line. A closed gate returns reason `gated`. Moves no tokens.
    function quote(uint256 shares)
        external
        view
        returns (uint256 navValue, uint256 fee, uint256 usdgOut, bool available, string memory reason);

    /// @notice Pulls `shares`, draws the line, and queues the vault withdrawal. Pays the seller `nav - fee`.
    function sellToLockgate(uint256 shares, uint256 minUsdgOut) external returns (uint256 positionId, uint256 usdgOut);

    /// @notice Anyone, once `readyAt` has passed. Claims the vault withdrawal and repays the line.
    function settle(uint256 positionId) external;

    /// @notice Position ids sold by `seller`, in sell order.
    function positionsOf(address seller) external view returns (uint256[] memory);

    /// @notice Stored position. Unknown ids are empty.
    function getPosition(uint256 id) external view returns (Position memory);

    /// @notice Highest position id. The next sale uses this plus one.
    function positionCount() external view returns (uint256);

    /// @notice Owner. A closed gate makes `quote` return `gated` and `sellToLockgate` revert. `settle` stays open.
    function setGated(bool isGated) external;

    /// @notice Open vault this pool buys and withdraws.
    function vault() external view returns (address);
}
