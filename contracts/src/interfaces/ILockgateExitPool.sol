// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ICreditSource} from "./ICreditSource.sol";

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

    function quote(uint256 shares)
        external
        view
        returns (uint256 navValue, uint256 fee, uint256 usdgOut, bool available, string memory reason);

    function sellToLockgate(uint256 shares, uint256 minUsdgOut) external returns (uint256 positionId, uint256 usdgOut);

    function settle(uint256 positionId) external;

    function positionsOf(address seller) external view returns (uint256[] memory);

    function getPosition(uint256 id) external view returns (Position memory);

    function positionCount() external view returns (uint256);

    function setGated(bool isGated) external;

    function vault() external view returns (address);
}
