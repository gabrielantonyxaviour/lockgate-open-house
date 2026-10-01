// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract MockPegOracle {
    uint256 public price;
    uint64 public updated;

    function set(uint256 priceE8, uint64 updatedAt) external {
        price = priceE8;
        updated = updatedAt;
    }

    function latest() external view returns (uint256 priceE8, uint64 updatedAt) {
        return (price, updated);
    }
}
