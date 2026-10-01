// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice USDG/USD price, 1e8 = $1. Partner sets this. Address zero disables the check.
interface IPegOracle {
    function latest() external view returns (uint256 priceE8, uint64 updatedAt);
}
