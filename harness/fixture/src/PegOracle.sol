// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Fixed peg answer for harness failure tests. Not a production oracle.
contract PegOracle {
    uint256 public immutable priceE8;
    uint64 public immutable updatedAt;

    constructor(uint256 priceE8_, uint64 updatedAt_) {
        priceE8 = priceE8_;
        updatedAt = updatedAt_;
    }

    function latest() external view returns (uint256, uint64) {
        return (priceE8, updatedAt);
    }
}
