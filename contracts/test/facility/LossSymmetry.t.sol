// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {FacilityMath} from "../../src/facility/libraries/FacilityMath.sol";
import {FacilityStore} from "../../src/facility/FacilityStore.sol";
import {FacilityFixture} from "./FacilityFixture.sol";

/// @notice A draw, a repayment, and a loss stay on one identity: unpaid drawn becomes deficit, cash does not move on the loss.
contract LossSymmetryTest is FacilityFixture {
    function testFuzz_unpaidDrawBecomesDeficitAndRepayRestoresSeniorFirst(
        uint96 seniorRaw,
        uint96 juniorRaw,
        uint96 drawRaw,
        uint96 repayRaw,
        uint96 restoreRaw
    ) public {
        _open(8_000, 10_000, 0, 0, 0, address(0), 0, 0);
        uint256 seniorAssets = bound(seniorRaw, 1e6, 500_000e6);
        uint256 juniorAssets = bound(juniorRaw, 0, 500_000e6);
        _deposit(senior, FacilityStore.Tranche.Senior, seniorAssets);
        if (juniorAssets > 0) _deposit(junior, FacilityStore.Tranche.Junior, juniorAssets);
        book.set(10_000_000e6, 0);
        uint256 room = facility.availableDraw();
        uint256 draw = bound(drawRaw, 1, room);
        vm.prank(borrower);
        facility.draw(draw);
        FacilityMath.State memory afterDraw = facility.accounting();
        uint256 seniorSlice = draw < seniorAssets ? draw : seniorAssets;
        assertEq(afterDraw.drawn, draw);
        assertEq(afterDraw.seniorDrawn, seniorSlice);
        assertEq(FacilityMath.idleSenior(afterDraw), seniorAssets - seniorSlice);
        assertEq(FacilityMath.idleJunior(afterDraw), juniorAssets - (draw - seniorSlice));
        assertEq(afterDraw.cash, seniorAssets + juniorAssets - draw);
        assertTrue(facility.solvent());
        assertEq(usdg.balanceOf(address(facility)), afterDraw.cash);

        uint256 repay = bound(repayRaw, 0, draw - 1);
        if (repay > 0) _repay(repay);
        FacilityMath.State memory afterRepay = facility.accounting();
        uint256 unpaid = draw - repay;
        uint256 seniorFreed = repay < seniorSlice ? repay : seniorSlice;
        assertEq(afterRepay.drawn, unpaid);
        assertEq(afterRepay.seniorDrawn, seniorSlice - seniorFreed);
        assertEq(FacilityMath.idleSenior(afterRepay), FacilityMath.idleSenior(afterDraw) + seniorFreed);
        assertEq(FacilityMath.idleJunior(afterRepay), FacilityMath.idleJunior(afterDraw) + (repay - seniorFreed));
        assertEq(afterRepay.cash, seniorAssets + juniorAssets - unpaid);
        assertEq(afterRepay.seniorDeficit + afterRepay.juniorDeficit, 0);
        assertTrue(facility.solvent());

        book.set(0, 0);
        facility.poke();
        uint256 drawnAfterPoke = facility.accounting().drawn;
        uint256 loss = facility.recognizeLoss();
        FacilityMath.State memory booked = facility.accounting();
        assertEq(loss, drawnAfterPoke);
        assertEq(booked.drawn, 0);
        assertEq(booked.seniorDeficit + booked.juniorDeficit, unpaid);
        assertEq(booked.cash, afterRepay.cash);
        assertEq(
            booked.seniorPrincipal + booked.seniorDeficit + booked.juniorPrincipal + booked.juniorDeficit,
            seniorAssets + juniorAssets
        );
        assertEq(usdg.balanceOf(address(facility)), booked.cash);
        assertTrue(facility.solvent());
        assertEq(facility.recognizeLoss(), 0);

        uint256 payCap = booked.seniorDeficit > 0 ? booked.seniorDeficit : booked.juniorDeficit;
        uint256 pay = bound(restoreRaw, 1, payCap);
        _repay(pay);
        FacilityMath.State memory restored = facility.accounting();
        if (booked.seniorDeficit > 0) {
            assertEq(restored.seniorDeficit, booked.seniorDeficit - pay);
            assertEq(restored.seniorPrincipal, booked.seniorPrincipal + pay);
            assertEq(restored.juniorDeficit, booked.juniorDeficit);
            assertEq(restored.residual, 0);
        } else {
            assertEq(restored.juniorDeficit, booked.juniorDeficit - pay);
            assertEq(restored.juniorPrincipal, booked.juniorPrincipal + pay);
            assertEq(restored.seniorDeficit, 0);
        }
        assertEq(restored.cash, booked.cash + pay);
        assertTrue(facility.solvent());
    }

    /// @notice Junior idle pays the senior slice once. The remaining draw is the loss.
    function test_drawAboveSeniorRecognizesTheUnpaidDrawOnce() public {
        _open(8_000, 10_000, 0, 0, 0, address(0), 0, 0);
        _deposit(senior, FacilityStore.Tranche.Senior, 100e6);
        _deposit(junior, FacilityStore.Tranche.Junior, 1_000e6);
        book.set(10_000_000e6, 0);
        vm.prank(borrower);
        facility.draw(500e6);
        book.set(0, 0);
        facility.poke();
        FacilityMath.State memory once = facility.accounting();
        assertEq(once.drawn, 400e6);
        assertEq(once.seniorDrawn, 0);
        assertEq(once.juniorPrincipal, 900e6);
        assertEq(once.juniorDeficit, 100e6);
        assertEq(once.seniorPrincipal, 100e6);
        uint256 loss = facility.recognizeLoss();
        FacilityMath.State memory booked = facility.accounting();
        assertEq(loss, 400e6);
        assertEq(booked.drawn, 0);
        assertEq(booked.juniorDeficit, 500e6);
        assertEq(booked.seniorDeficit, 0);
        assertEq(booked.seniorPrincipal, 100e6);
        assertEq(booked.juniorPrincipal, 500e6);
        assertEq(booked.cash, 600e6);
        assertTrue(facility.solvent());
        assertEq(facility.recognizeLoss(), 0);
        assertEq(facility.accounting().juniorPrincipal, 500e6);
        assertEq(facility.accounting().juniorDeficit, 500e6);
    }

    /// @notice After junior idle has paid the senior slice, a 1-unit repayment pays the junior slice.
    function test_repayWhileDrawExceedsSeniorPullsOnlyThatPayment() public {
        _open(8_000, 10_000, 0, 0, 0, address(0), 0, 0);
        _deposit(senior, FacilityStore.Tranche.Senior, 100e6);
        _deposit(junior, FacilityStore.Tranche.Junior, 1_000e6);
        book.set(10_000_000e6, 0);
        vm.prank(borrower);
        facility.draw(500e6);
        book.set(0, 0);
        facility.poke();
        _repay(1);
        FacilityMath.State memory paid = facility.accounting();
        assertEq(paid.drawn, 400e6 - 1);
        assertEq(paid.seniorDrawn, 0);
        assertEq(paid.juniorPrincipal, 900e6);
        assertEq(paid.juniorDeficit, 100e6);
        assertEq(paid.seniorPrincipal, 100e6);
        assertEq(paid.cash, 600e6 + 1);
        assertEq(usdg.balanceOf(address(facility)), paid.cash);
        assertTrue(facility.solvent());
    }

    /// @notice Outside recovery, a repayment of the senior slice frees senior redemption. The next unit frees junior.
    function test_repayFreesSeniorIdleBeforeJunior() public {
        _open(8_000, 10_000, 0, 0, 0, address(0), 0, 0);
        _deposit(senior, FacilityStore.Tranche.Senior, 100e6);
        _deposit(junior, FacilityStore.Tranche.Junior, 1_000e6);
        book.set(10_000_000e6, 0);
        vm.prank(borrower);
        facility.draw(500e6);
        FacilityMath.State memory drawn = facility.accounting();
        assertEq(drawn.seniorDrawn, 100e6);
        assertEq(drawn.drawn, 500e6);
        assertEq(drawn.cash, 600e6);
        assertEq(FacilityMath.idleSenior(drawn), 0);
        assertEq(FacilityMath.idleJunior(drawn), 600e6);
        vm.prank(senior);
        vm.expectRevert(FacilityStore.BadParam.selector);
        facility.redeem(FacilityStore.Tranche.Senior, 1);
        vm.prank(junior);
        vm.expectRevert(FacilityStore.BadParam.selector);
        facility.redeem(FacilityStore.Tranche.Junior, 600e6 + 1);

        _repay(100e6);
        FacilityMath.State memory repaid = facility.accounting();
        assertEq(repaid.seniorDrawn, 0);
        assertEq(repaid.drawn, 400e6);
        assertEq(repaid.cash, 700e6);
        assertEq(FacilityMath.idleSenior(repaid), 100e6);
        assertEq(FacilityMath.idleJunior(repaid), 600e6);
        vm.prank(senior);
        assertEq(facility.redeem(FacilityStore.Tranche.Senior, 100e6), 100e6);
        vm.prank(junior);
        vm.expectRevert(FacilityStore.BadParam.selector);
        facility.redeem(FacilityStore.Tranche.Junior, 600e6 + 1);

        _repay(1);
        FacilityMath.State memory tail = facility.accounting();
        assertEq(tail.drawn, 400e6 - 1);
        assertEq(tail.seniorDrawn, 0);
        assertEq(tail.seniorPrincipal, 0);
        assertEq(FacilityMath.idleSenior(tail), 0);
        assertEq(FacilityMath.idleJunior(tail), 600e6 + 1);
        assertEq(tail.cash, 600e6 + 1);
        assertTrue(facility.solvent());
    }

    function _repay(uint256 amount) internal {
        usdg.mint(borrower, amount);
        vm.startPrank(borrower);
        usdg.approve(address(facility), amount);
        facility.repay(amount);
        vm.stopPrank();
    }
}
