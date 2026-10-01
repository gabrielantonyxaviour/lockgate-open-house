// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Platform gate the vault staticcalls. `gated() == true` or a stale NAV blocks an advance.
contract MockPlatform {
    bool public gatedFlag;
    uint64 public navUpdatedAt;

    function set(bool gated_, uint64 updatedAt) external {
        gatedFlag = gated_;
        navUpdatedAt = updatedAt;
    }

    function gated() external view returns (bool) {
        return gatedFlag;
    }
}
