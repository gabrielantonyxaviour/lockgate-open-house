// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {FacilityStore} from "../../src/facility/FacilityStore.sol";
import {FacilityFixture} from "./FacilityFixture.sol";

contract WideOracle {
    function latest() external pure returns (uint256, uint256) {
        return (1e8, type(uint256).max);
    }
}

contract FacilitySecurityTest is FacilityFixture {
    function test_advanceRateCutDoesNotForgiveTheDraw() public {
        _open(8_000, 2_000, 1_000, 0, 0, address(0), 0, 0);
        _deposit(senior, FacilityStore.Tranche.Senior, 500_000e6);
        _deposit(junior, FacilityStore.Tranche.Junior, 100_000e6);
        vm.prank(borrower);
        facility.draw(200_000e6);
        vm.prank(governor);
        facility.tightenAdvanceRate(0);
        facility.poke();
        uint256 loss = facility.recognizeLoss();
        assertEq(loss, 0);
        assertEq(facility.accounting().drawn, 100_000e6);
        assertEq(facility.accounting().seniorPrincipal, 500_000e6);
        assertEq(facility.accounting().juniorPrincipal, 0);
        assertEq(facility.availableDraw(), 0);
        assertTrue(facility.solvent());
    }

    function test_rateChangeKeepsInterestAlreadyEarned() public {
        _open(10_000, 10_000, 0, 1_000, 0, address(0), 0, 0);
        _deposit(senior, FacilityStore.Tranche.Senior, 1_000_000e6);
        vm.prank(borrower);
        facility.draw(100_000e6);
        vm.prank(governor);
        facility.scheduleTerms(
            FacilityStore.PendingTerms({
                advanceRateBps: 10_000,
                maxLateBps: 10_000,
                minJuniorBps: 0,
                seniorAprBps: 0,
                juniorAprBps: 0,
                eta: 0,
                active: false
            })
        );
        vm.warp(2 days + 1);
        vm.prank(governor);
        facility.executeTerms();
        uint256 due = facility.accounting().seniorInterestDue;
        uint256 expected = Math.mulDiv(Math.mulDiv(100_000e6, 1_000, 10_000), 2 days, 365 days);
        assertEq(due, expected);
        assertGt(due, 0);
        vm.warp(facility.accounting().lastAccrual + 2 days);
        facility.poke();
        assertEq(facility.accounting().seniorInterestDue, due);
        assertEq(facility.accounting().seniorAprBps, 0);
    }

    function test_juniorCannotDepositIntoRecovery() public {
        _open(8_000, 2_000, 1_000, 0, 0, address(0), 0, 0);
        _deposit(senior, FacilityStore.Tranche.Senior, 500_000e6);
        _deposit(junior, FacilityStore.Tranche.Junior, 100_000e6);
        vm.prank(borrower);
        facility.draw(200_000e6);
        book.set(0, 0);
        facility.poke();
        usdg.mint(junior, 1_000e6);
        vm.startPrank(junior);
        usdg.approve(address(facility), 1_000e6);
        vm.expectRevert(FacilityStore.SeniorFirst.selector);
        facility.deposit(FacilityStore.Tranche.Junior, 1_000e6);
        vm.stopPrank();
        usdg.mint(senior, 1_000e6);
        vm.startPrank(senior);
        usdg.approve(address(facility), 1_000e6);
        facility.deposit(FacilityStore.Tranche.Senior, 1_000e6);
        vm.stopPrank();
        assertEq(facility.accounting().seniorPrincipal, 501_000e6);
    }

    function test_wideOracleDoesNotBrickDraws() public {
        _open(8_000, 10_000, 0, 0, 0, address(new WideOracle()), 1e8, 1 days);
        _deposit(senior, FacilityStore.Tranche.Senior, 100_000e6);
        assertEq(facility.availableDraw(), 0);
        facility.poke();
        assertTrue(facility.accounting().recovery);
        vm.prank(borrower);
        vm.expectRevert(FacilityStore.Covenant.selector);
        facility.draw(1);
    }
}
