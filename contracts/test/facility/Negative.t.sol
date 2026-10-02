// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {CreditFacility} from "../../src/facility/CreditFacility.sol";
import {FacilityStore} from "../../src/facility/FacilityStore.sol";
import {FacilityFixture} from "./FacilityFixture.sol";

/// @notice Borrower that tries to draw again from inside the token transfer.
contract DrawAgain {
    CreditFacility public facility;
    bool public drewAgain;
    bytes4 public sel;

    function arm(address next) external {
        facility = CreditFacility(next);
    }

    function pull(uint256 amount) external {
        facility.draw(amount);
    }

    function onTokens() external {
        try facility.draw(1) {
            drewAgain = true;
        } catch (bytes memory err) {
            sel = _sel(err);
        }
    }

    function _sel(bytes memory err) private pure returns (bytes4 s) {
        if (err.length < 4) return bytes4(0);
        assembly {
            s := mload(add(err, 32))
        }
    }
}

contract FacilityNegativeTest is FacilityFixture {
    function setUp() public {
        _open(10_000, 2_000, 0, 10_000, 0, address(0), 0, 0);
    }

    function test_strangerAndRevokedLenderCannotEnter() public {
        address stranger = makeAddr("stranger");
        vm.startPrank(stranger);
        vm.expectRevert(FacilityStore.Unauthorized.selector);
        facility.approveLender(stranger, true);
        vm.expectRevert(FacilityStore.Unauthorized.selector);
        facility.tightenAdvanceRate(1);
        vm.expectRevert(FacilityStore.Unauthorized.selector);
        facility.scheduleBook(address(1));
        vm.expectRevert(FacilityStore.Unauthorized.selector);
        facility.sweepResidual(stranger, 1);
        vm.stopPrank();
        vm.startPrank(borrower);
        vm.expectRevert(FacilityStore.Unauthorized.selector);
        facility.approveLender(borrower, true);
        vm.expectRevert(FacilityStore.Unauthorized.selector);
        facility.tightenMinJunior(1);
        vm.stopPrank();

        _deposit(senior, FacilityStore.Tranche.Senior, 100e6);
        assertEq(facility.lenderCount(), 1);
        vm.prank(governor);
        facility.approveLender(senior, false);
        usdg.mint(senior, 1e6);
        vm.startPrank(senior);
        usdg.approve(address(facility), 1e6);
        vm.expectRevert(FacilityStore.Unauthorized.selector);
        facility.deposit(FacilityStore.Tranche.Senior, 1e6);
        uint256 shares = facility.seniorShares(senior);
        uint256 assets = facility.redeem(FacilityStore.Tranche.Senior, shares);
        vm.stopPrank();
        assertEq(assets, 100e6);
        assertEq(facility.seniorShares(senior), 0);
        vm.prank(governor);
        facility.approveLender(senior, true);
        _deposit(senior, FacilityStore.Tranche.Senior, 1e6);
        assertEq(facility.lenderCount(), 1);
    }

    function test_drawReentrancyPaysOnce() public {
        DrawAgain actor = new DrawAgain();
        facility = new CreditFacility(
            FacilityStore.Init({
                governor: governor,
                borrower: address(actor),
                asset: address(usdg),
                book: address(book),
                oracle: address(0),
                minPriceE8: 0,
                maxOracleAge: 0,
                advanceRateBps: 10_000,
                maxLateBps: 2_000,
                minJuniorBps: 0,
                seniorAprBps: 0,
                juniorAprBps: 0
            })
        );
        actor.arm(address(facility));
        _deposit(senior, FacilityStore.Tranche.Senior, 100e6);
        usdg.setHook(address(actor));
        actor.pull(40e6);
        assertFalse(actor.drewAgain());
        assertEq(actor.sel(), ReentrancyGuard.ReentrancyGuardReentrantCall.selector);
        assertEq(usdg.balanceOf(address(actor)), 40e6);
        assertEq(facility.accounting().drawn, 40e6);
        assertEq(facility.accounting().cash, 60e6);
        assertTrue(facility.solvent());
    }

    /// @dev One unit of interest across three shares does not divide. The lender cannot withdraw it.
    function test_interestDustDoesNotRoundUpToTheLender() public {
        _deposit(senior, FacilityStore.Tranche.Senior, 3);
        vm.prank(borrower);
        facility.draw(3);
        vm.warp(facility.accounting().lastAccrual + 10_512_000);
        usdg.mint(borrower, 1);
        vm.startPrank(borrower);
        usdg.approve(address(facility), 1);
        facility.repay(1);
        vm.stopPrank();
        assertEq(facility.seniorClaim(senior), 0);
        assertEq(facility.accounting().seniorInterestDue, 0);
        assertEq(facility.accounting().residual, 1);
        assertEq(facility.accounting().seniorInterestCash, 0);
        vm.prank(senior);
        vm.expectRevert(FacilityStore.BadParam.selector);
        facility.withdrawInterest(FacilityStore.Tranche.Senior);
        assertEq(usdg.balanceOf(senior), 0);
        assertEq(usdg.balanceOf(address(facility)), facility.accounting().cash);
        assertTrue(facility.solvent());
    }
}
