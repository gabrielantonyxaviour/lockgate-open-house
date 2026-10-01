// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {CreditFacility} from "../../src/facility/CreditFacility.sol";
import {FacilityStore} from "../../src/facility/FacilityStore.sol";
import {FacilityMath} from "../../src/facility/libraries/FacilityMath.sol";
import {MockPegOracle} from "../partner/mocks/MockPegOracle.sol";
import {MockBook} from "./mocks/MockBook.sol";
import {FacilityFixture} from "./FacilityFixture.sol";

contract FacilityCovenantsTest is FacilityFixture {
    function setUp() public {
        _open(8_000, 2_000, 2_000, 0, 0, address(0), 0, 0);
        _deposit(senior, FacilityStore.Tranche.Senior, 800_000e6);
        _deposit(junior, FacilityStore.Tranche.Junior, 200_000e6);
    }

    function test_exactJuniorRatioStillDraws() public {
        vm.prank(borrower);
        facility.draw(800_000e6);
        assertEq(facility.accounting().drawn, 800_000e6);
        assertFalse(facility.accounting().recovery);
    }

    function test_lenderCapAndNoTransfer() public {
        for (uint256 i; i < 48; ++i) {
            address lender = address(uint160(0x1000 + i));
            vm.prank(governor);
            facility.approveLender(lender, true);
            usdg.mint(lender, 1e6);
            vm.startPrank(lender);
            usdg.approve(address(facility), 1e6);
            facility.deposit(FacilityStore.Tranche.Senior, 1e6);
            vm.stopPrank();
        }
        address extra = address(0x2000);
        vm.prank(governor);
        facility.approveLender(extra, true);
        usdg.mint(extra, 1e6);
        vm.startPrank(extra);
        usdg.approve(address(facility), 1e6);
        vm.expectRevert(FacilityStore.LenderCap.selector);
        facility.deposit(FacilityStore.Tranche.Senior, 1e6);
        vm.stopPrank();
        (bool ok,) = address(facility).call(abi.encodeWithSignature("transfer(address,uint256)", extra, 1));
        assertFalse(ok);
    }

    function test_borrowerAndGovernorCannotTakeDeposits() public {
        vm.prank(governor);
        vm.expectRevert(FacilityStore.Unauthorized.selector);
        facility.draw(1);
        vm.prank(makeAddr("stranger"));
        vm.expectRevert(FacilityStore.Unauthorized.selector);
        facility.draw(1);
        vm.prank(governor);
        vm.expectRevert(FacilityStore.BadParam.selector);
        facility.redeem(FacilityStore.Tranche.Senior, 1);
        vm.prank(governor);
        vm.expectRevert(FacilityStore.BadParam.selector);
        facility.sweepResidual(governor, 1);
        assertEq(usdg.balanceOf(address(facility)), 1_000_000e6);
    }

    function test_bookChangeIsTimelocked() public {
        MockBook next = new MockBook();
        next.set(5_000_000e6, 0);
        vm.prank(governor);
        facility.scheduleBook(address(next));
        vm.prank(governor);
        vm.expectRevert(FacilityStore.TooEarly.selector);
        facility.executeBook();
        vm.warp(block.timestamp + 2 days);
        vm.prank(governor);
        facility.executeBook();
        assertEq(facility.receivables(), address(next));
        assertEq(facility.borrowingBase(), 4_000_000e6);
    }

    function test_tighterNowLooserAfterDelay() public {
        vm.prank(governor);
        vm.expectRevert(FacilityStore.BadParam.selector);
        facility.tightenAdvanceRate(8_000);
        vm.prank(governor);
        facility.tightenAdvanceRate(7_000);
        assertEq(facility.accounting().advanceRateBps, 7_000);
        vm.prank(governor);
        facility.scheduleTerms(
            FacilityStore.PendingTerms({
                advanceRateBps: 9_000,
                maxLateBps: 2_000,
                minJuniorBps: 2_000,
                seniorAprBps: 0,
                juniorAprBps: 0,
                eta: 0,
                active: false
            })
        );
        vm.prank(governor);
        vm.expectRevert(FacilityStore.TooEarly.selector);
        facility.executeTerms();
        vm.warp(block.timestamp + 2 days);
        vm.prank(governor);
        facility.executeTerms();
        assertEq(facility.accounting().advanceRateBps, 9_000);
    }

    function test_depegRecoveryStaysAfterThePegReturns() public {
        MockPegOracle oracle = new MockPegOracle();
        oracle.set(1e8, uint64(block.timestamp));
        _open(8_000, 2_000, 2_000, 0, 0, address(oracle), 99_000_000, 1 days);
        _deposit(senior, FacilityStore.Tranche.Senior, 800_000e6);
        _deposit(junior, FacilityStore.Tranche.Junior, 200_000e6);
        vm.prank(borrower);
        facility.draw(100_000e6);
        oracle.set(50_000_000, uint64(block.timestamp));
        vm.prank(borrower);
        vm.expectRevert(FacilityStore.Covenant.selector);
        facility.draw(1);
        facility.poke();
        assertTrue(facility.accounting().recovery);
        oracle.set(1e8, uint64(block.timestamp));
        vm.prank(borrower);
        vm.expectRevert(FacilityStore.Covenant.selector);
        facility.draw(1);
        assertTrue(facility.accounting().recovery);
        assertEq(facility.availableDraw(), 0);
    }
}
