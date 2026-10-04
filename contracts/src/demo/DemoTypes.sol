// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

struct DemoQuote {
    bytes32 holdingId;
    address vault;
    address investor;
    bytes32 identity;
    uint256 units;
    uint256 payout;
    uint256 repayment;
    uint8 route;
    uint64 deadline;
    uint64 maturity;
    uint256 nonce;
    bytes32 agreementHash;
}
