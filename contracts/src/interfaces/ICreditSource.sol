// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Read surface every advance source must expose. LockgateCreditLine calls these before a draw.
interface ICreditSource {
    /// @notice USDG (6 decimals) per 1e18 shares.
    function nav() external view returns (uint256);

    function navUpdatedAt() external view returns (uint64);

    function gated() external view returns (bool);

    /// @notice Timestamp when the current withdrawal cycle can settle. Draws revert once this is due.
    function nextWindow() external view returns (uint64);
}
