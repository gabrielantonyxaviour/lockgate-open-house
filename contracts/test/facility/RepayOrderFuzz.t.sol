// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {FacilityMath} from "../../src/facility/libraries/FacilityMath.sol";

/// @notice Repayment fills senior interest, senior principal, senior deficit, then the junior legs, then residual.
contract RepayOrderFuzzTest is Test {
    FacilityMath.State internal s;

    function testFuzz_waterfallPaysInOrder(
        uint128 seniorRaw,
        uint128 juniorRaw,
        uint128 drawnRaw,
        uint128 seniorDueRaw,
        uint128 juniorDueRaw,
        uint128 seniorDefRaw,
        uint128 juniorDefRaw,
        uint128 payRaw
    ) public {
        uint256 amount = _load(seniorRaw, juniorRaw, drawnRaw, seniorDueRaw, juniorDueRaw, seniorDefRaw, juniorDefRaw, payRaw);
        uint256 cash = s.cash;
        FacilityMath.Split memory expect = _buckets(amount);
        FacilityMath.Split memory split = FacilityMath.onRepay(s, amount);
        assertEq(split.seniorInterest, expect.seniorInterest);
        assertEq(split.seniorPrincipalPay, expect.seniorPrincipalPay);
        assertEq(split.seniorRestore, expect.seniorRestore);
        assertEq(split.juniorInterest, expect.juniorInterest);
        assertEq(split.juniorPrincipalPay, expect.juniorPrincipalPay);
        assertEq(split.juniorRestore, expect.juniorRestore);
        assertEq(split.residualAdd, expect.residualAdd);
        assertEq(s.residual, expect.residualAdd);
        assertEq(s.cash, cash + amount);
        assertTrue(FacilityMath.solvent(s));
        if (expect.residualAdd > 0) {
            assertEq(s.seniorInterestDue, 0);
            assertEq(s.seniorDeficit, 0);
            assertEq(s.drawn, 0);
            assertEq(s.juniorInterestDue, 0);
            assertEq(s.juniorDeficit, 0);
        }
    }

    function _load(
        uint128 seniorRaw,
        uint128 juniorRaw,
        uint128 drawnRaw,
        uint128 seniorDueRaw,
        uint128 juniorDueRaw,
        uint128 seniorDefRaw,
        uint128 juniorDefRaw,
        uint128 payRaw
    ) internal returns (uint256 amount) {
        delete s;
        uint256 seniorP = bound(seniorRaw, 0, 1e24);
        uint256 juniorP = bound(juniorRaw, 0, 1e24);
        s.seniorPrincipal = seniorP;
        s.juniorPrincipal = juniorP;
        s.drawn = bound(drawnRaw, 0, seniorP + juniorP);
        s.seniorDrawn = s.drawn < seniorP ? s.drawn : seniorP;
        s.cash = seniorP + juniorP - s.drawn;
        s.seniorInterestDue = bound(seniorDueRaw, 0, 1e24);
        s.juniorInterestDue = bound(juniorDueRaw, 0, 1e24);
        s.seniorDeficit = bound(seniorDefRaw, 0, 1e24);
        s.juniorDeficit = bound(juniorDefRaw, 0, 1e24);
        amount = bound(payRaw, 0, 1e24);
        assertTrue(FacilityMath.solvent(s));
    }

    function _buckets(uint256 amount) internal view returns (FacilityMath.Split memory expect) {
        uint256 seniorOut = s.seniorDrawn;
        uint256 juniorOut = s.drawn - seniorOut;
        uint256 left = amount;
        expect.seniorInterest = _take(s.seniorInterestDue, left);
        left -= expect.seniorInterest;
        expect.seniorPrincipalPay = _take(seniorOut, left);
        left -= expect.seniorPrincipalPay;
        expect.seniorRestore = _take(s.seniorDeficit, left);
        left -= expect.seniorRestore;
        expect.juniorInterest = _take(s.juniorInterestDue, left);
        left -= expect.juniorInterest;
        expect.juniorPrincipalPay = _take(juniorOut, left);
        left -= expect.juniorPrincipalPay;
        expect.juniorRestore = _take(s.juniorDeficit, left);
        left -= expect.juniorRestore;
        expect.residualAdd = left;
    }

    function _take(uint256 owed, uint256 avail) private pure returns (uint256 paid) {
        paid = avail < owed ? avail : owed;
    }
}
