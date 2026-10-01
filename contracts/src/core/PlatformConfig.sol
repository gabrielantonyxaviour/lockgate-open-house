// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

struct PlatformConfig {
    address token;
    address creditLine;
    address reserve;
    address issuer;
    string name;
    uint256 nav;
    uint64 interval;
    address initialHolder;
    uint256 initialShares;
}
