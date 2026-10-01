// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Why a vault will not fund an exit. `None` means the terms pass.
enum RejectReason {
    None,
    Paused,
    MandateExpired,
    Platform,
    Recipient,
    Limit,
    Concentration,
    Fee,
    Tenor,
    Cash,
    Reserve,
    Peg,
    StaleOracle,
    Gated,
    StaleNav,
    Zero,
    Deadline
}

enum AdvanceStatus {
    None,
    Active,
    Repaid,
    Late,
    WrittenOff
}

struct Advance {
    address platform;
    address recipient;
    uint256 navValue;
    uint256 fee;
    uint256 principal;
    uint256 principalRemaining;
    uint256 feeRemaining;
    uint256 owed;
    uint64 fundedAt;
    uint64 dueAt;
    /// @notice Queue item bound into the engine signature. Zero is allowed; the signature still covers it.
    uint256 requestId;
    /// @notice Engine `quoteId`. The router attributes repayment by this id.
    bytes32 exitRef;
    AdvanceStatus status;
}

struct PlatformConfig {
    bool approved;
    uint256 limit;
    uint16 reserveBps;
    bool checkGate;
    uint64 maxNavAge;
}

struct MandateView {
    address partner;
    address signer;
    uint16 minFeeBps;
    uint64 maxTenor;
    uint16 concentrationBps;
    uint64 expiry;
}
