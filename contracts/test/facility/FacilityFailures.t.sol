// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {CreditFacility} from "../../src/facility/CreditFacility.sol";
import {FacilityStore} from "../../src/facility/FacilityStore.sol";
import {FeeUSDG} from "../partner/mocks/FeeUSDG.sol";
import {FacilityFixture} from "./FacilityFixture.sol";

contract RevertBook {
    function eligibleOutstanding() external pure returns (uint256) {
        revert("unread");
    }

    function lateOutstanding() external pure returns (uint256) {
        revert("unread");
    }
}

contract FacilityFailuresTest is FacilityFixture {
    event TermsCancelled();

    function setUp() public {
        _open(8_000, 2_000, 0, 0, 0, address(0), 0, 0);
        _deposit(senior, FacilityStore.Tranche.Senior, 100_000e6);
    }

    function test_governorCannotBeTheBorrower() public {
        address same = makeAddr("same");
        vm.expectRevert(FacilityStore.BadParam.selector);
        new CreditFacility(
            FacilityStore.Init({
                governor: same,
                borrower: same,
                asset: address(usdg),
                book: address(book),
                oracle: address(0),
                minPriceE8: 0,
                maxOracleAge: 0,
                advanceRateBps: 8_000,
                maxLateBps: 2_000,
                minJuniorBps: 0,
                seniorAprBps: 0,
                juniorAprBps: 0
            })
        );
    }

    function test_cancelTermsEmitsAndSecondCancelReverts() public {
        vm.prank(governor);
        facility.scheduleTerms(
            FacilityStore.PendingTerms({
                advanceRateBps: 1_000,
                maxLateBps: 1_000,
                minJuniorBps: 0,
                seniorAprBps: 100,
                juniorAprBps: 100,
                eta: 0,
                active: false
            })
        );
        vm.expectEmit(false, false, false, true, address(facility));
        emit TermsCancelled();
        vm.prank(governor);
        facility.cancelTerms();
        vm.prank(governor);
        vm.expectRevert(FacilityStore.BadParam.selector);
        facility.cancelTerms();
        vm.warp(block.timestamp + 2 days);
        vm.prank(governor);
        vm.expectRevert(FacilityStore.TooEarly.selector);
        facility.executeTerms();
        assertEq(facility.accounting().advanceRateBps, 8_000);
    }

    function test_lossBeforeRecoveryAndSweepWhileSeniorIsDrawn() public {
        vm.expectRevert(FacilityStore.NotRecovery.selector);
        facility.recognizeLoss();
        vm.prank(borrower);
        facility.draw(40_000e6);
        usdg.mint(borrower, 100_000e6);
        vm.startPrank(borrower);
        usdg.approve(address(facility), 100_000e6);
        facility.repay(100_000e6);
        facility.draw(20_000e6);
        vm.stopPrank();
        book.set(0, 0);
        facility.poke();
        assertTrue(facility.accounting().recovery);
        assertGt(facility.accounting().residual, 0);
        assertGt(facility.accounting().drawn, 0);
        vm.prank(governor);
        vm.expectRevert(FacilityStore.SeniorFirst.selector);
        facility.sweepResidual(governor, 1);
    }

    function test_unreadableBookStopsDraws() public {
        RevertBook broken = new RevertBook();
        vm.prank(governor);
        facility.scheduleBook(address(broken));
        vm.warp(block.timestamp + 2 days);
        vm.prank(governor);
        facility.executeBook();
        assertEq(facility.availableDraw(), 0);
        vm.prank(borrower);
        vm.expectRevert(FacilityStore.Covenant.selector);
        facility.draw(1);
    }

    function test_revokingALenderDoesNotFreeTheCap() public {
        for (uint256 i; i < 49; ++i) {
            address lender = address(uint160(0x3100 + i));
            vm.prank(governor);
            facility.approveLender(lender, true);
            usdg.mint(lender, 1e6);
            vm.startPrank(lender);
            usdg.approve(address(facility), 1e6);
            facility.deposit(FacilityStore.Tranche.Junior, 1e6);
            vm.stopPrank();
        }
        assertEq(facility.lenderCount(), 50);
        vm.prank(governor);
        facility.approveLender(senior, false);
        assertEq(facility.lenderCount(), 50);
        address extra = address(0x3200);
        vm.prank(governor);
        facility.approveLender(extra, true);
        usdg.mint(extra, 1e6);
        vm.startPrank(extra);
        usdg.approve(address(facility), 1e6);
        vm.expectRevert(FacilityStore.LenderCap.selector);
        facility.deposit(FacilityStore.Tranche.Junior, 1e6);
        vm.stopPrank();
    }

    function test_feeOnTransferDepositReverts() public {
        FeeUSDG fee = new FeeUSDG();
        CreditFacility taxed = new CreditFacility(
            FacilityStore.Init({
                governor: governor,
                borrower: borrower,
                asset: address(fee),
                book: address(book),
                oracle: address(0),
                minPriceE8: 0,
                maxOracleAge: 0,
                advanceRateBps: 8_000,
                maxLateBps: 2_000,
                minJuniorBps: 0,
                seniorAprBps: 0,
                juniorAprBps: 0
            })
        );
        vm.prank(governor);
        taxed.approveLender(senior, true);
        fee.mint(senior, 1_000e6);
        vm.startPrank(senior);
        fee.approve(address(taxed), 1_000e6);
        vm.expectRevert(FacilityStore.BadParam.selector);
        taxed.deposit(FacilityStore.Tranche.Senior, 1_000e6);
        vm.stopPrank();
    }
}
