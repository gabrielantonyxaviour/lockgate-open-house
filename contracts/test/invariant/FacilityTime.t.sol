// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {MockUSDG} from "../../src/core/MockUSDG.sol";
import {CreditFacility} from "../../src/facility/CreditFacility.sol";
import {FacilityStore} from "../../src/facility/FacilityStore.sol";
import {FacilityMath} from "../../src/facility/libraries/FacilityMath.sol";
import {ReceivablesBook} from "./mocks/ReceivablesBook.sol";

/// @notice One year of senior interest, and a peg that stops draws. `vm.warp` stays inside this test.
contract FacilityTime is Test {
    uint256 internal constant U = 1e6;
    uint256 internal constant DRAWN = 40_000 * U;
    /// @dev floor(floor(40_000e6 * 800 / 10_000) * 365 days / 365 days) = 3_200e6.
    uint256 internal constant YEAR_INTEREST = 3_200 * U;

    MockUSDG internal token;
    ReceivablesBook internal book;
    PegWord internal oracle;
    CreditFacility internal facility;
    address internal borrower = makeAddr("borrower");
    address internal lockgate = makeAddr("lockgate");

    function setUp() public {
        token = new MockUSDG(address(this));
        book = new ReceivablesBook();
        book.set(2_000_000 * U, 0);
        oracle = new PegWord();
    }

    function test_oneYearOfSeniorInterestStaysInTheCashIdentity() public {
        facility = new CreditFacility(_init(address(0), 0, 0, 800, 1_500));
        _fund(80_000 * U, 20_000 * U);
        vm.prank(borrower);
        facility.draw(DRAWN);
        uint64 start = facility.accounting().lastAccrual;
        vm.warp(start + 365 days);
        facility.poke();
        FacilityMath.State memory owed = facility.accounting();
        assertEq(owed.seniorInterestDue, YEAR_INTEREST);
        assertEq(owed.juniorInterestDue, 0);
        assertEq(owed.seniorInterestCash, 0);
        assertTrue(facility.solvent());
        assertEq(token.balanceOf(address(facility)), owed.cash);

        token.mint(borrower, YEAR_INTEREST);
        vm.prank(borrower);
        facility.repay(DRAWN + YEAR_INTEREST);
        FacilityMath.State memory paid = facility.accounting();
        assertEq(paid.drawn, 0);
        assertEq(paid.seniorInterestDue, 0);
        assertEq(paid.seniorInterestCash, YEAR_INTEREST);
        assertEq(token.balanceOf(address(facility)), paid.cash);
        assertTrue(facility.solvent());
        _conserved();

        vm.warp(paid.lastAccrual + 365 days);
        facility.poke();
        assertEq(facility.accounting().seniorInterestDue, 0);
        _conserved();
    }

    function test_priceOneUnitUnderTheFloorStopsTheDraw() public {
        facility = new CreditFacility(_init(address(oracle), 99_000_000, 1 days, 0, 0));
        _fund(50_000 * U, 10_000 * U);
        uint64 start = facility.accounting().lastAccrual;
        oracle.set(99_000_000, start);
        vm.prank(borrower);
        facility.draw(10_000 * U);
        oracle.set(98_999_999, start);
        assertEq(facility.availableDraw(), 0);
        uint256 supply = token.totalSupply();
        uint256 cash = token.balanceOf(address(facility));
        uint256 held = token.balanceOf(borrower);
        vm.prank(borrower);
        vm.expectRevert(FacilityStore.Covenant.selector);
        facility.draw(1);
        assertEq(token.totalSupply(), supply);
        assertEq(token.balanceOf(address(facility)), cash);
        assertEq(token.balanceOf(borrower), held);
        facility.poke();
        assertTrue(facility.accounting().recovery);
        oracle.set(1e8, start);
        assertTrue(facility.accounting().recovery);
        assertEq(facility.availableDraw(), 0);
        assertEq(token.balanceOf(address(facility)), facility.accounting().cash);
        assertTrue(facility.solvent());
        _conserved();
    }

    function test_oracleAgeOfOneDayIsFreshAndOneSecondLaterStopsTheDraw() public {
        facility = new CreditFacility(_init(address(oracle), 99_000_000, 1 days, 0, 0));
        _fund(50_000 * U, 10_000 * U);
        uint64 start = facility.accounting().lastAccrual;
        oracle.set(1e8, start);
        vm.warp(start + 1 days);
        assertGt(facility.availableDraw(), 0);
        vm.warp(start + 1 days + 1);
        assertEq(facility.availableDraw(), 0);
        uint256 cash = token.balanceOf(address(facility));
        vm.prank(borrower);
        vm.expectRevert(FacilityStore.Covenant.selector);
        facility.draw(1);
        assertEq(token.balanceOf(address(facility)), cash);
        assertEq(token.balanceOf(lockgate), 0);
        assertTrue(facility.solvent());
    }

    function _fund(uint256 senior, uint256 junior) internal {
        facility.approveLender(address(this), true);
        token.mint(address(this), senior + junior);
        token.approve(address(facility), type(uint256).max);
        facility.deposit(FacilityStore.Tranche.Senior, senior);
        facility.deposit(FacilityStore.Tranche.Junior, junior);
        vm.prank(borrower);
        token.approve(address(facility), type(uint256).max);
    }

    function _conserved() internal view {
        uint256 held = token.balanceOf(address(this)) + token.balanceOf(address(facility)) + token.balanceOf(borrower)
            + token.balanceOf(lockgate);
        assertEq(held, token.totalSupply());
        assertEq(token.balanceOf(lockgate), 0);
    }

    function _init(address peg, uint64 floor, uint64 age, uint64 seniorApr, uint64 juniorApr)
        internal
        view
        returns (FacilityStore.Init memory init)
    {
        init = FacilityStore.Init({
            governor: address(this),
            borrower: borrower,
            asset: address(token),
            book: address(book),
            oracle: peg,
            minPriceE8: floor,
            maxOracleAge: age,
            advanceRateBps: 10_000,
            maxLateBps: 10_000,
            minJuniorBps: 0,
            seniorAprBps: seniorApr,
            juniorAprBps: juniorApr
        });
    }
}

contract PegWord {
    uint256 internal price;
    uint64 internal updated;

    function set(uint256 priceE8, uint64 updatedAt) external {
        price = priceE8;
        updated = updatedAt;
    }

    function latest() external view returns (uint256 priceE8, uint64 updatedAt) {
        return (price, updated);
    }
}
