// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {Test} from "forge-std/Test.sol";
import {FeeMath} from "../../src/partner/libraries/FeeMath.sol";
import {MandateLogic} from "../../src/partner/libraries/MandateLogic.sol";
import {RejectReason} from "../../src/partner/Types.sol";

/// @notice Every mandate reject reason, in check order, plus a mixed input against that same order.
contract MandateFuzzTest is Test {
    function testFuzz_oneBrokenRail(uint8 whichRaw, uint128 navRaw, uint64 timeRaw) public pure {
        uint64 nowTs = uint64(bound(timeRaw, 30 days, 365 days));
        MandateLogic.Input memory p = _sound(bound(navRaw, 1e6, 1e24), nowTs);
        uint256 which = bound(whichRaw, 0, 19);
        RejectReason expect = RejectReason.None;
        if (which == 0) {
            p.paused = true;
            expect = RejectReason.Paused;
        } else if (which == 1) {
            p.expiry = 0;
            expect = RejectReason.MandateExpired;
        } else if (which == 2) {
            p.deadline = 0;
            expect = RejectReason.Deadline;
        } else if (which == 3) {
            p.approved = false;
            expect = RejectReason.Platform;
        } else if (which == 4) {
            p.recipient = address(0xB0B);
            expect = RejectReason.Recipient;
        } else if (which == 5) {
            p.navValue = 0;
            p.fee = 0;
            p.payout = 0;
            expect = RejectReason.Zero;
        } else if (which == 6) {
            p.dueAt = nowTs;
            expect = RejectReason.Tenor;
        } else if (which == 7) {
            p.oracleReason = RejectReason.StaleOracle;
            expect = RejectReason.StaleOracle;
        } else if (which == 8) {
            p.gateReason = RejectReason.Gated;
            expect = RejectReason.Gated;
        } else if (which == 9) {
            p.fee = p.fee - 1;
            p.payout = p.navValue - p.fee;
            expect = RejectReason.Fee;
        } else if (which == 10) {
            p.idle = p.payout - 1;
            expect = RejectReason.Cash;
        } else if (which == 11) {
            p.limit = p.navValue - 1;
            expect = RejectReason.Limit;
        } else if (which == 12) {
            p.concentrationBps = 0;
            expect = RejectReason.Concentration;
        } else if (which == 13) {
            uint256 required = Math.mulDiv(p.navValue, p.reserveBps, FeeMath.BPS, Math.Rounding.Ceil);
            p.reserve = required - 1;
            expect = RejectReason.Reserve;
        } else if (which == 14) {
            p.deadline = nowTs - 1;
            expect = RejectReason.Deadline;
        } else if (which == 15) {
            p.maxTenor = 0;
            expect = RejectReason.Tenor;
        } else if (which == 17) {
            p.payout = 0;
            expect = RejectReason.Zero;
        } else if (which == 18) {
            p.platform = address(0);
            expect = RejectReason.Platform;
        } else if (which == 19) {
            p.dueAt = nowTs + 31 days;
            expect = RejectReason.Tenor;
        } else {
            p.payoutTo = address(0xCAFE);
            expect = RejectReason.Recipient;
        }
        assertEq(uint256(MandateLogic.check(p)), uint256(expect));
    }

    function testFuzz_mixedInputFollowsCheckOrder(
        uint128 navRaw,
        uint128 feeRaw,
        uint128 idleRaw,
        uint128 limitRaw,
        uint128 exposureRaw,
        uint128 reserveRaw,
        uint128 assetsRaw,
        uint16 minFeeRaw,
        uint16 concRaw,
        uint16 reserveBpsRaw,
        uint64 nowRaw,
        uint64 dueRaw,
        uint64 expiryRaw,
        uint64 deadlineRaw,
        uint64 tenorRaw,
        uint8 oracleRaw,
        uint8 gateRaw,
        bool paused,
        bool approved
    ) public pure {
        MandateLogic.Input memory p;
        p.paused = paused;
        p.timestamp = uint64(bound(nowRaw, 1, 500 days));
        p.minFeeBps = uint16(bound(minFeeRaw, 0, 20_000));
        p.maxTenor = uint64(bound(tenorRaw, 0, 120 days));
        p.concentrationBps = uint16(bound(concRaw, 0, 20_000));
        p.expiry = uint64(bound(expiryRaw, 0, 800 days));
        p.approved = approved;
        p.limit = bound(limitRaw, 0, 1e24);
        p.reserveBps = uint16(bound(reserveBpsRaw, 0, 20_000));
        p.exposure = bound(exposureRaw, 0, 1e24);
        p.reserve = bound(reserveRaw, 0, 1e24);
        p.idle = bound(idleRaw, 0, 1e24);
        p.totalAssets = bound(assetsRaw, 0, 1e24);
        p.platform = address(0xA11);
        p.recipient = address(0xA11);
        p.navValue = bound(navRaw, 0, 1e24);
        p.fee = bound(feeRaw, 0, 1e24);
        p.payout = p.fee < p.navValue ? p.navValue - p.fee : 0;
        p.dueAt = uint64(bound(dueRaw, 0, 800 days));
        p.deadline = uint64(bound(deadlineRaw, 0, 800 days));
        p.oracleReason = RejectReason(bound(oracleRaw, 0, 16));
        p.gateReason = RejectReason(bound(gateRaw, 0, 16));
        assertEq(uint256(MandateLogic.check(p)), uint256(_expect(p)));
        if (MandateLogic.check(p) == RejectReason.None) _railsHold(p);
    }

    function _railsHold(MandateLogic.Input memory p) private pure {
        assertFalse(p.paused);
        assertTrue(p.expiry != 0 && p.timestamp <= p.expiry);
        assertTrue(p.deadline != 0 && p.timestamp <= p.deadline);
        assertTrue(p.approved && p.platform != address(0));
        assertEq(p.recipient, p.platform);
        assertTrue(p.navValue > 0 && p.fee < p.navValue && p.payout == p.navValue - p.fee);
        assertTrue(p.dueAt > p.timestamp && p.maxTenor != 0);
        assertLe(uint256(p.dueAt) - p.timestamp, p.maxTenor);
        assertTrue(p.oracleReason == RejectReason.None && p.gateReason == RejectReason.None);
        assertGe(p.fee, FeeMath.minFee(p.navValue, p.minFeeBps));
        assertLe(p.navValue - p.fee, p.idle);
        assertLe(p.navValue, p.limit);
        assertLe(p.exposure, p.limit - p.navValue);
        uint256 cap = Math.mulDiv(p.totalAssets, p.concentrationBps, FeeMath.BPS);
        assertLe(p.navValue, cap);
        assertLe(p.exposure, cap - p.navValue);
        if (p.reserveBps > 0) {
            uint256 required = Math.mulDiv(p.exposure + p.navValue, p.reserveBps, FeeMath.BPS, Math.Rounding.Ceil);
            assertGe(p.reserve, required);
        }
    }

    function _expect(MandateLogic.Input memory p) private pure returns (RejectReason) {
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
            uint256 required = Math.mulDiv(p.exposure + p.navValue, p.reserveBps, FeeMath.BPS, Math.Rounding.Ceil);
            if (p.reserve < required) return RejectReason.Reserve;
        }
        return RejectReason.None;
    }

    function _sound(uint256 nav, uint64 nowTs) private pure returns (MandateLogic.Input memory p) {
        p.timestamp = nowTs;
        p.minFeeBps = 100;
        p.maxTenor = 30 days;
        p.concentrationBps = 10_000;
        p.expiry = nowTs + 30 days;
        p.approved = true;
        p.limit = type(uint128).max;
        p.reserveBps = 500;
        p.reserve = nav;
        p.idle = nav;
        p.totalAssets = nav;
        p.platform = address(0xA11);
        p.recipient = address(0xA11);
        p.navValue = nav;
        p.fee = FeeMath.minFee(nav, 100);
        p.payout = nav - p.fee;
        p.dueAt = nowTs + 7 days;
        p.deadline = nowTs + 1 hours;
    }
}
