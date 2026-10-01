// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {FeeMath} from "../../src/partner/libraries/FeeMath.sol";
import {MandateLogic} from "../../src/partner/libraries/MandateLogic.sol";
import {RouterLogic} from "../../src/partner/libraries/RouterLogic.sol";
import {RejectReason} from "../../src/partner/Types.sol";

contract LogicFuzzTest is Test {
    function testFuzz_bestPicksLowestFeeThenHigherIdle(uint16 aRaw, uint16 bRaw, uint128 idleARaw, uint128 idleBRaw, uint128 navRaw)
        public
        pure
    {
        uint16 a = uint16(bound(aRaw, 0, 9_999));
        uint16 b = uint16(bound(bRaw, 0, 9_999));
        uint256 idleA = bound(idleARaw, 0, 1e24);
        uint256 idleB = bound(idleBRaw, 0, 1e24);
        uint256 nav = bound(navRaw, 1e6, 1e18);
        RouterLogic.Candidate[] memory rows = new RouterLogic.Candidate[](2);
        rows[0] = RouterLogic.Candidate(address(0xA1), nav, a, idleA);
        rows[1] = RouterLogic.Candidate(address(0xA2), nav, b, idleB);
        (RouterLogic.Slice memory pick, bool ok) = RouterLogic.best(rows, nav);
        assertTrue(ok);
        uint16 low = a < b ? a : b;
        assertEq(pick.feeBps, low);
        address expect = address(0xA1);
        if (b < a || (a == b && idleB > idleA)) expect = address(0xA2);
        assertEq(pick.vault, expect);
        uint256 fee = FeeMath.mulDivHalfUp(nav, low, 10_000);
        if (fee >= nav) fee = nav - 1;
        assertEq(pick.fee, fee);
        assertLt(pick.fee, pick.navValue);
    }

    function testFuzz_proRataEqualCapsFillTheNav(uint128 capRaw, uint128 navRaw) public pure {
        uint256 cap = bound(capRaw, 1e6, 1e20);
        uint256 nav = bound(navRaw, 2, cap * 2);
        RouterLogic.Candidate[] memory rows = new RouterLogic.Candidate[](2);
        rows[0] = RouterLogic.Candidate(address(0xA1), cap, 100, 1);
        rows[1] = RouterLogic.Candidate(address(0xA2), cap, 250, 1);
        RouterLogic.Slice[] memory filled = RouterLogic.proRata(rows, nav);
        uint256 sum;
        for (uint256 i; i < filled.length; ++i) {
            assertLe(filled[i].navValue, cap);
            assertLt(filled[i].fee, filled[i].navValue);
            sum += filled[i].navValue;
        }
        assertEq(sum, nav);
    }

    function testFuzz_robinReturnsTheOnlyEligibleVault(uint8 cursorRaw, uint8 eligibleRaw) public pure {
        uint256 eligible = bound(eligibleRaw, 0, 3);
        uint256 cursor = bound(cursorRaw, 0, 3);
        RouterLogic.Candidate[] memory rows = new RouterLogic.Candidate[](4);
        for (uint256 i; i < 4; ++i) {
            rows[i] = RouterLogic.Candidate(address(uint160(i + 1)), i == eligible ? 100e6 : 0, 100, 1);
        }
        (RouterLogic.Slice memory pick, uint256 index, bool ok) = RouterLogic.robin(rows, 100e6, cursor);
        assertTrue(ok);
        assertEq(index, eligible);
        assertEq(pick.vault, address(uint160(eligible + 1)));
        assertEq(pick.navValue, 100e6);
    }

    function testFuzz_mandateBoundaries(uint64 nowRaw, uint64 tenorRaw) public pure {
        uint64 nowTs = uint64(bound(nowRaw, 1 days, 1_000 days));
        uint64 tenor = uint64(bound(tenorRaw, 1 hours, 90 days));
        MandateLogic.Input memory p = _pass(nowTs, tenor);
        assertEq(uint256(MandateLogic.check(p)), uint256(RejectReason.None));

        p.deadline = nowTs;
        p.dueAt = uint64(uint256(nowTs) + tenor);
        assertEq(uint256(MandateLogic.check(p)), uint256(RejectReason.None));

        p.dueAt = nowTs;
        assertEq(uint256(MandateLogic.check(p)), uint256(RejectReason.Tenor));

        p = _pass(nowTs, tenor);
        p.expiry = nowTs;
        assertEq(uint256(MandateLogic.check(p)), uint256(RejectReason.None));
        p.expiry = nowTs - 1;
        assertEq(uint256(MandateLogic.check(p)), uint256(RejectReason.MandateExpired));
        p.expiry = 0;
        assertEq(uint256(MandateLogic.check(p)), uint256(RejectReason.MandateExpired));

        p = _pass(nowTs, tenor);
        p.concentrationBps = 0;
        assertEq(uint256(MandateLogic.check(p)), uint256(RejectReason.Concentration));

        p = _pass(nowTs, tenor);
        p.idle = p.payout - 1;
        assertEq(uint256(MandateLogic.check(p)), uint256(RejectReason.Cash));

        p = _pass(nowTs, tenor);
        uint256 floorFee = FeeMath.minFee(p.navValue, p.minFeeBps);
        p.fee = floorFee - 1;
        p.payout = p.navValue - p.fee;
        assertEq(uint256(MandateLogic.check(p)), uint256(RejectReason.Fee));

        p = _pass(nowTs, tenor);
        p.paused = true;
        assertEq(uint256(MandateLogic.check(p)), uint256(RejectReason.Paused));
    }

    function _pass(uint64 nowTs, uint64 tenor) internal pure returns (MandateLogic.Input memory p) {
        p.timestamp = nowTs;
        p.minFeeBps = 100;
        p.maxTenor = tenor;
        p.concentrationBps = 10_000;
        p.expiry = nowTs + tenor;
        p.approved = true;
        p.limit = 1e24;
        p.idle = 1e24;
        p.totalAssets = 1e24;
        p.platform = address(0xA1);
        p.recipient = address(0xA1);
        p.navValue = 1e12;
        p.fee = 1e10;
        p.payout = p.navValue - p.fee;
        p.dueAt = uint64(uint256(nowTs) + tenor);
        p.deadline = nowTs + 1 hours;
    }
}
