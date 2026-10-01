// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {Test} from "forge-std/Test.sol";
import {CreditFacility} from "../../src/facility/CreditFacility.sol";
import {FacilityStore} from "../../src/facility/FacilityStore.sol";
import {FacilityMath} from "../../src/facility/libraries/FacilityMath.sol";
import {FacilityFixture} from "./FacilityFixture.sol";

contract FacilityMathFuzzTest is FacilityFixture {
    FacilityMath.State internal s;

    function testFuzz_accrueMatchesTwoStepMulDiv(uint128 principalRaw, uint16 aprRaw, uint32 dtRaw) public {
        delete s;
        uint256 principal = bound(principalRaw, 1, 1e24);
        uint256 apr = bound(aprRaw, 0, 10_000);
        uint256 dt = bound(dtRaw, 1, 365 days);
        s.drawn = principal;
        s.seniorPrincipal = principal;
        s.seniorAprBps = uint64(apr);
        s.lastAccrual = 1;
        FacilityMath.accrue(s, 1 + dt);
        uint256 perYear = Math.mulDiv(principal, apr, 10_000);
        assertEq(s.seniorInterestDue, Math.mulDiv(perYear, dt, 365 days));
        assertTrue(FacilityMath.solvent(s));
    }

    function testFuzz_recoveryAccruesNothing(uint32 dtRaw) public {
        delete s;
        uint256 dt = bound(dtRaw, 1, 365 days);
        s.drawn = 1e18;
        s.seniorPrincipal = 1e18;
        s.seniorAprBps = 1_000;
        s.recovery = true;
        s.lastAccrual = 1;
        FacilityMath.accrue(s, 1 + dt);
        assertEq(s.seniorInterestDue, 0);
        assertTrue(FacilityMath.solvent(s));
    }

    function testFuzz_repayRestoresSeniorDeficitBeforeJunior(uint128 deficitRaw, uint128 payRaw) public {
        delete s;
        uint256 deficit = bound(deficitRaw, 1, 1e24);
        uint256 pay = bound(payRaw, 1, deficit);
        s.seniorDeficit = deficit;
        s.juniorDeficit = deficit;
        FacilityMath.onRepay(s, pay);
        assertEq(s.seniorDeficit, deficit - pay);
        assertEq(s.seniorPrincipal, pay);
        assertEq(s.juniorDeficit, deficit);
        assertEq(s.juniorPrincipal, 0);
        assertEq(s.residual, 0);
        assertTrue(FacilityMath.solvent(s));
    }

    function testFuzz_lossHitsJuniorBeforeSenior(uint128 juniorRaw, uint128 seniorRaw, uint128 lossRaw) public {
        delete s;
        uint256 junior = bound(juniorRaw, 0, 1e24);
        uint256 senior = bound(seniorRaw, 0, 1e24);
        uint256 loss = bound(lossRaw, 0, junior + senior);
        s.juniorPrincipal = junior;
        s.seniorPrincipal = senior;
        s.drawn = junior + senior;
        uint256 applied = FacilityMath.applyLoss(s, loss);
        uint256 juniorTake = loss < junior ? loss : junior;
        uint256 seniorTake = loss - juniorTake;
        assertEq(s.juniorPrincipal, junior - juniorTake);
        assertEq(s.seniorPrincipal, senior - seniorTake);
        assertEq(s.juniorDeficit, juniorTake);
        assertEq(s.seniorDeficit, seniorTake);
        assertEq(applied, juniorTake + seniorTake);
        assertEq(s.drawn, junior + senior - applied);
        assertTrue(FacilityMath.solvent(s));
    }

    function testFuzz_drawNeverExceedsTheBorrowingBase(uint96 seniorRaw, uint96 bookRaw, uint96 drawRaw) public {
        _open(8_000, 10_000, 0, 0, 0, address(0), 0, 0);
        uint256 assets = bound(seniorRaw, 0, 1_000_000e6);
        if (assets > 0) _deposit(senior, FacilityStore.Tranche.Senior, assets);
        book.set(bound(bookRaw, 0, 1_000_000e6), 0);
        uint256 room = facility.availableDraw();
        uint256 want = bound(drawRaw, 0, 2_000_000e6);
        if (want == 0 || want > room) {
            vm.prank(borrower);
            vm.expectRevert(want == 0 ? FacilityStore.Unauthorized.selector : FacilityStore.Covenant.selector);
            facility.draw(want);
            return;
        }
        vm.prank(borrower);
        facility.draw(want);
        assertLe(facility.accounting().drawn, facility.borrowingBase());
        assertLe(facility.accounting().drawn, assets);
        assertTrue(facility.solvent());
    }
}
