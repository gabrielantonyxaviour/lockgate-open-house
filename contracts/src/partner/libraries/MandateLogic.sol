// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {RejectReason} from "../Types.sol";
import {FeeMath} from "./FeeMath.sol";

/// @title MandateLogic
/// @notice Pure mandate check. Exposure and limits are in owed-nav units, matching the off-chain quote.
library MandateLogic {
    struct Input {
        bool paused;
        uint256 timestamp;
        uint16 minFeeBps;
        uint64 maxTenor;
        uint16 concentrationBps;
        uint64 expiry;
        bool approved;
        uint256 limit;
        uint16 reserveBps;
        uint256 exposure;
        uint256 reserve;
        uint256 idle;
        uint256 totalAssets;
        address platform;
        address recipient;
        address payoutTo;
        uint256 navValue;
        uint256 fee;
        uint256 payout;
        uint64 dueAt;
        uint64 deadline;
        RejectReason oracleReason;
        RejectReason gateReason;
    }

    function check(Input memory p) internal pure returns (RejectReason) {
        if (p.paused) return RejectReason.Paused;
        if (p.expiry == 0 || p.timestamp > p.expiry) return RejectReason.MandateExpired;
        if (p.deadline == 0 || p.timestamp > p.deadline) return RejectReason.Deadline;
        if (!p.approved || p.platform == address(0)) return RejectReason.Platform;
        address expected = p.payoutTo == address(0) ? p.platform : p.payoutTo;
        if (p.recipient != expected) return RejectReason.Recipient;
        if (p.navValue == 0 || p.fee >= p.navValue || p.payout != p.navValue - p.fee) return RejectReason.Zero;
        if (p.dueAt <= p.timestamp || p.maxTenor == 0 || uint256(p.dueAt) - p.timestamp > p.maxTenor) {
            return RejectReason.Tenor;
        }
        if (p.oracleReason != RejectReason.None) return p.oracleReason;
        if (p.gateReason != RejectReason.None) return p.gateReason;
        if (p.fee < FeeMath.minFee(p.navValue, p.minFeeBps)) return RejectReason.Fee;
        if (p.navValue - p.fee > p.idle) return RejectReason.Cash;
        if (p.navValue > p.limit || p.exposure > p.limit - p.navValue) return RejectReason.Limit;
        uint256 cap = Math.mulDiv(p.totalAssets, p.concentrationBps, FeeMath.BPS);
        if (p.navValue > cap || p.exposure > cap - p.navValue) return RejectReason.Concentration;
        if (p.reserveBps > 0) {
            uint256 required =
                Math.mulDiv(p.exposure + p.navValue, p.reserveBps, FeeMath.BPS, Math.Rounding.Ceil);
            if (p.reserve < required) return RejectReason.Reserve;
        }
        return RejectReason.None;
    }
}
