// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ILockgateCreditLine} from "../../src/interfaces/ILockgateCreditLine.sol";
import {CreditFacility} from "../../src/facility/CreditFacility.sol";
import {CreditLineBook} from "../../src/facility/CreditLineBook.sol";
import {FacilityStore} from "../../src/facility/FacilityStore.sol";
import {PartnerVault} from "../../src/partner/PartnerVault.sol";
import {CoreStack} from "../partner/CoreStack.sol";

/// @notice Facility borrowing base is the stage-1 line, through CreditLineBook, on a fresh deploy.
contract FacilityCoreBookTest is CoreStack {
    uint256 internal constant LINE_NAV = 10_000 * UNIT;

    CreditFacility internal facility;
    CreditLineBook internal book;
    PartnerVault internal vault;
    address internal governor;
    address internal borrower;
    address internal senior;
    address internal partner;

    function setUp() public {
        _core(500);
        _armSource(500 * UNIT);
        book = new CreditLineBook(address(line));
        governor = makeAddr("governor");
        borrower = makeAddr("borrower");
        senior = makeAddr("senior");
        partner = vm.addr(0xB0B);
        vault = _vault(partner);
        _fundVault(vault, partner, 7_000 * UNIT);
        facility = new CreditFacility(
            FacilityStore.Init({
                governor: governor,
                borrower: borrower,
                asset: address(token),
                book: address(book),
                oracle: address(0),
                minPriceE8: 0,
                maxOracleAge: 0,
                advanceRateBps: 10_000,
                maxLateBps: 10_000,
                minJuniorBps: 0,
                seniorAprBps: 0,
                juniorAprBps: 0
            })
        );
    }

    function test_lineBookCapsTheFacilityDraw() public {
        source.refresh();
        source.draw(LINE_NAV);
        assertEq(book.eligibleOutstanding(), line.eligibleOutstanding());
        assertEq(book.eligibleOutstanding(), LINE_NAV);
        assertEq(book.lateOutstanding(), line.lateOutstanding());

        _deposit(12_000 * UNIT);
        assertEq(facility.availableDraw(), LINE_NAV);
        uint256 vaultBal = token.balanceOf(address(vault));
        uint256 lineCash = line.capital();
        vm.prank(borrower);
        facility.draw(LINE_NAV);
        vm.prank(borrower);
        vm.expectRevert(FacilityStore.Covenant.selector);
        facility.draw(1);
        assertEq(facility.accounting().drawn, LINE_NAV);
        assertEq(facility.accounting().cash, 2_000 * UNIT);
        assertEq(token.balanceOf(borrower), LINE_NAV);
        assertEq(token.balanceOf(address(vault)), vaultBal);
        assertEq(line.capital(), lineCash);
        assertTrue(facility.solvent());
    }

    function test_lateBookStopsTheNextDraw() public {
        source.refresh();
        (uint256 id,) = source.draw(LINE_NAV);
        ILockgateCreditLine.Advance memory advance = line.getAdvance(id);
        vm.warp(uint256(advance.dueAt) + line.graceOf(id));
        line.markLate(id);

        uint256 left = LINE_NAV - 500 * UNIT;
        assertEq(book.eligibleOutstanding(), 0);
        assertEq(book.lateOutstanding(), left);
        assertEq(book.eligibleOutstanding() + book.lateOutstanding(), line.totalExposure());
        _deposit(LINE_NAV);
        assertEq(facility.availableDraw(), 0);
        uint256 vaultBal = token.balanceOf(address(vault));
        vm.prank(borrower);
        vm.expectRevert(FacilityStore.Covenant.selector);
        facility.draw(1);
        assertEq(token.balanceOf(address(vault)), vaultBal);
        assertEq(facility.accounting().drawn, 0);
    }

    function test_vaultIsNotABorrowingBase() public {
        uint256 vaultBal = token.balanceOf(address(vault));
        CreditLineBook wrong = new CreditLineBook(address(vault));
        vm.expectRevert();
        wrong.eligibleOutstanding();

        CreditFacility boxed = new CreditFacility(
            FacilityStore.Init({
                governor: governor,
                borrower: borrower,
                asset: address(token),
                book: address(wrong),
                oracle: address(0),
                minPriceE8: 0,
                maxOracleAge: 0,
                advanceRateBps: 10_000,
                maxLateBps: 10_000,
                minJuniorBps: 0,
                seniorAprBps: 0,
                juniorAprBps: 0
            })
        );
        vm.prank(governor);
        boxed.approveLender(senior, true);
        token.mint(senior, 1_000 * UNIT);
        vm.startPrank(senior);
        token.approve(address(boxed), 1_000 * UNIT);
        boxed.deposit(FacilityStore.Tranche.Senior, 1_000 * UNIT);
        vm.stopPrank();
        assertEq(boxed.availableDraw(), 0);
        vm.prank(borrower);
        vm.expectRevert(FacilityStore.Covenant.selector);
        boxed.draw(1);
        assertEq(token.balanceOf(address(vault)), vaultBal);
        assertEq(boxed.accounting().cash, 1_000 * UNIT);
    }

    function _deposit(uint256 amount) internal {
        vm.prank(governor);
        facility.approveLender(senior, true);
        token.mint(senior, amount);
        vm.startPrank(senior);
        token.approve(address(facility), amount);
        facility.deposit(FacilityStore.Tranche.Senior, amount);
        vm.stopPrank();
    }
}
