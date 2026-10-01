// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {CreditFacility} from "../../src/facility/CreditFacility.sol";
import {FacilityStore} from "../../src/facility/FacilityStore.sol";
import {FacilityMath} from "../../src/facility/libraries/FacilityMath.sol";
import {PartnerVault} from "../../src/partner/PartnerVault.sol";
import {PartnerVaultAdmin} from "../../src/partner/PartnerVaultAdmin.sol";
import {FacilityFixture} from "./FacilityFixture.sol";

contract FacilityWaterfallTest is FacilityFixture {
    PartnerVault internal partnerVault;

    function setUp() public {
        _open(8_000, 2_000, 2_000, 1_000, 2_000, address(0), 0, 0);
        _deposit(senior, FacilityStore.Tranche.Senior, 800_000e6);
        _deposit(junior, FacilityStore.Tranche.Junior, 200_000e6);
        PartnerVault impl = new PartnerVault();
        partnerVault = PartnerVault(
            address(
                new ERC1967Proxy(
                    address(impl),
                    abi.encodeCall(PartnerVaultAdmin.initialize, (makeAddr("partner"), address(usdg), 1 days, 1 days))
                )
            )
        );
        address partner = partnerVault.owner();
        usdg.mint(partner, 123e6);
        vm.startPrank(partner);
        usdg.approve(address(partnerVault), 123e6);
        partnerVault.deposit(123e6);
        vm.stopPrank();
    }

    function test_defaultWaterfallRestoresSeniorBeforeResidual() public {
        vm.prank(borrower);
        facility.draw(800_000e6);
        vm.prank(borrower);
        vm.expectRevert(FacilityStore.Covenant.selector);
        facility.draw(1);
        book.set(0, 1_000_000e6);
        facility.poke();
        FacilityMath.State memory recovered = facility.accounting();
        assertTrue(recovered.recovery);
        assertEq(recovered.juniorPrincipal, 0);
        assertEq(recovered.juniorDeficit, 200_000e6);
        assertEq(recovered.drawn, 600_000e6);
        assertEq(recovered.seniorPrincipal, 800_000e6);
        assertEq(recovered.cash, 200_000e6);
        assertTrue(facility.solvent());

        uint256 loss = facility.recognizeLoss();
        assertEq(loss, 600_000e6);
        FacilityMath.State memory booked = facility.accounting();
        assertEq(booked.seniorPrincipal, 200_000e6);
        assertEq(booked.seniorDeficit, 600_000e6);
        assertEq(booked.drawn, 0);
        assertEq(booked.residual, 0);
        assertTrue(facility.solvent());

        usdg.mint(borrower, 100_000e6);
        vm.startPrank(borrower);
        usdg.approve(address(facility), 100_000e6);
        facility.repay(100_000e6);
        vm.stopPrank();
        FacilityMath.State memory afterRepay = facility.accounting();
        assertEq(afterRepay.seniorPrincipal, 300_000e6);
        assertEq(afterRepay.seniorDeficit, 500_000e6);
        assertEq(afterRepay.juniorPrincipal, 0);
        assertEq(afterRepay.residual, 0);
        assertTrue(facility.solvent());
        vm.prank(governor);
        vm.expectRevert(FacilityStore.BadParam.selector);
        facility.sweepResidual(governor, 1);
        vm.prank(junior);
        vm.expectRevert(FacilityStore.BadParam.selector);
        facility.redeem(FacilityStore.Tranche.Junior, 1);
        _partnerUntouched();
    }

    function testFuzz_repayCannotSkipSeniorDeficit(uint96 raw) public {
        vm.prank(borrower);
        facility.draw(800_000e6);
        book.set(0, 1_000_000e6);
        facility.poke();
        facility.recognizeLoss();
        uint256 repay = bound(raw, 1, 600_000e6);
        usdg.mint(borrower, repay);
        vm.startPrank(borrower);
        usdg.approve(address(facility), repay);
        facility.repay(repay);
        vm.stopPrank();
        FacilityMath.State memory s = facility.accounting();
        assertEq(s.residual, 0);
        assertEq(s.seniorDeficit, 600_000e6 - repay);
        assertEq(s.seniorPrincipal, 200_000e6 + repay);
        assertEq(s.juniorDeficit, 200_000e6);
        assertTrue(facility.solvent());
        _partnerUntouched();
    }

    function test_interestPaysSeniorFirst() public {
        CreditFacility live = new CreditFacility(
            FacilityStore.Init({
                governor: governor,
                borrower: borrower,
                asset: address(usdg),
                book: address(book),
                oracle: address(0),
                minPriceE8: 0,
                maxOracleAge: 0,
                advanceRateBps: 10_000,
                maxLateBps: 10_000,
                minJuniorBps: 0,
                seniorAprBps: 1_000,
                juniorAprBps: 0
            })
        );
        vm.prank(governor);
        live.approveLender(senior, true);
        usdg.mint(senior, 100e6);
        vm.startPrank(senior);
        usdg.approve(address(live), 100e6);
        live.deposit(FacilityStore.Tranche.Senior, 100e6);
        vm.stopPrank();
        vm.prank(borrower);
        live.draw(100e6);
        vm.warp(block.timestamp + 365 days);
        usdg.mint(borrower, 110e6);
        vm.startPrank(borrower);
        usdg.approve(address(live), 110e6);
        live.repay(110e6);
        vm.stopPrank();
        FacilityMath.State memory s = live.accounting();
        assertEq(s.seniorInterestDue, 0);
        assertEq(s.seniorInterestCash, 10e6);
        assertEq(s.drawn, 0);
        assertTrue(live.solvent());
        vm.prank(senior);
        assertEq(live.withdrawInterest(FacilityStore.Tranche.Senior), 10e6);
    }

    function test_mixedDrawPaysSeniorInterestBeforeJunior() public {
        CreditFacility live = new CreditFacility(
            FacilityStore.Init({
                governor: governor,
                borrower: borrower,
                asset: address(usdg),
                book: address(book),
                oracle: address(0),
                minPriceE8: 0,
                maxOracleAge: 0,
                advanceRateBps: 10_000,
                maxLateBps: 10_000,
                minJuniorBps: 2_000,
                seniorAprBps: 1_000,
                juniorAprBps: 2_000
            })
        );
        vm.startPrank(governor);
        live.approveLender(senior, true);
        live.approveLender(junior, true);
        vm.stopPrank();
        usdg.mint(senior, 100e6);
        usdg.mint(junior, 100e6);
        vm.startPrank(senior);
        usdg.approve(address(live), 100e6);
        live.deposit(FacilityStore.Tranche.Senior, 100e6);
        vm.stopPrank();
        vm.startPrank(junior);
        usdg.approve(address(live), 100e6);
        live.deposit(FacilityStore.Tranche.Junior, 100e6);
        vm.stopPrank();
        vm.prank(borrower);
        live.draw(150e6);
        vm.warp(block.timestamp + 365 days);
        usdg.mint(borrower, 20e6);
        vm.startPrank(borrower);
        usdg.approve(address(live), 20e6);
        live.repay(20e6);
        vm.stopPrank();
        FacilityMath.State memory s = live.accounting();
        assertEq(s.seniorInterestDue, 0);
        assertEq(s.seniorInterestCash, 10e6);
        assertEq(s.juniorInterestDue, 10e6);
        assertEq(s.drawn, 140e6);
        assertTrue(live.solvent());
        _partnerUntouched();
    }

    function _partnerUntouched() internal view {
        assertEq(partnerVault.idle(), 123e6);
        assertEq(usdg.balanceOf(address(partnerVault)), 123e6);
        assertEq(partnerVault.outstandingPrincipal(), 0);
    }
}
