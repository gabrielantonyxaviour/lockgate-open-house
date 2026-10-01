// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {MockUSDG} from "../../src/core/MockUSDG.sol";
import {CreditFacility} from "../../src/facility/CreditFacility.sol";
import {FacilityStore} from "../../src/facility/FacilityStore.sol";
import {FacilityMath} from "../../src/facility/libraries/FacilityMath.sol";
import {ReceivablesBook} from "./mocks/ReceivablesBook.sol";

/// @notice Stage-3 facility: borrowing-base reject, and junior principal before senior principal.
contract FacilityWaterfall is Test {
    uint256 internal constant U = 1e6;

    MockUSDG internal token;
    ReceivablesBook internal book;
    CreditFacility internal facility;
    address internal borrower = makeAddr("borrower");
    address internal stranger = makeAddr("stranger");

    function setUp() public {
        token = new MockUSDG(address(this));
        book = new ReceivablesBook();
        facility = new CreditFacility(_init(address(book)));
        facility.approveLender(address(this), true);
        token.mint(address(this), 600_000 * U);
        token.approve(address(facility), type(uint256).max);
        facility.deposit(FacilityStore.Tranche.Senior, 500_000 * U);
        facility.deposit(FacilityStore.Tranche.Junior, 100_000 * U);
    }

    function test_drawAboveTheBorrowingBaseReverts() public {
        book.set(0, 0);
        vm.prank(borrower);
        vm.expectRevert(FacilityStore.Covenant.selector);
        facility.draw(1);
        book.set(1_000_000 * U, 0);
        uint256 room = facility.availableDraw();
        assertEq(room, 600_000 * U);
        vm.prank(borrower);
        vm.expectRevert(FacilityStore.Covenant.selector);
        facility.draw(room + 1);
    }

    function test_governorCannotDraw() public {
        book.set(1_000_000 * U, 0);
        vm.expectRevert(FacilityStore.Unauthorized.selector);
        facility.draw(1);
    }

    function test_strangerCannotDraw() public {
        book.set(1_000_000 * U, 0);
        vm.prank(stranger);
        vm.expectRevert(FacilityStore.Unauthorized.selector);
        facility.draw(1);
    }

    function test_juniorIsExhaustedBeforeSeniorIsWrittenDown() public {
        book.set(1_000_000 * U, 0);
        vm.prank(borrower);
        facility.draw(200_000 * U);
        book.set(0, 0);
        facility.poke();

        FacilityMath.State memory mid = facility.accounting();
        assertTrue(mid.recovery);
        assertEq(mid.juniorPrincipal, 0);
        assertEq(mid.seniorPrincipal, 500_000 * U);
        assertEq(mid.drawn, 100_000 * U);
        vm.expectRevert(FacilityStore.SeniorFirst.selector);
        facility.redeem(FacilityStore.Tranche.Junior, 1);

        uint256 loss = facility.recognizeLoss();
        FacilityMath.State memory afterLoss = facility.accounting();
        assertEq(loss, 100_000 * U);
        assertEq(afterLoss.juniorPrincipal, 0);
        assertEq(afterLoss.seniorPrincipal, 400_000 * U);
        assertEq(afterLoss.drawn, 0);
        assertEq(token.balanceOf(address(facility)), afterLoss.cash);
    }

    function test_juniorCashCoversASmallerDrawWithoutTouchingSenior() public {
        token.mint(address(this), 300_000 * U);
        facility.deposit(FacilityStore.Tranche.Junior, 300_000 * U);
        book.set(2_000_000 * U, 0);
        vm.prank(borrower);
        facility.draw(200_000 * U);
        uint256 seniorBefore = facility.accounting().seniorPrincipal;
        book.set(0, 0);
        facility.poke();
        uint256 loss = facility.recognizeLoss();
        FacilityMath.State memory state = facility.accounting();
        assertEq(loss, 0);
        assertEq(state.seniorPrincipal, seniorBefore);
        assertEq(state.drawn, 0);
        assertLt(state.juniorPrincipal, 400_000 * U);
        assertEq(token.balanceOf(address(facility)), state.cash);
    }

    function _init(address book_) internal view returns (FacilityStore.Init memory init) {
        init = FacilityStore.Init({
            governor: address(this),
            borrower: borrower,
            asset: address(token),
            book: book_,
            oracle: address(0),
            minPriceE8: 0,
            maxOracleAge: 0,
            advanceRateBps: 8_000,
            maxLateBps: 2_000,
            minJuniorBps: 1_000,
            seniorAprBps: 800,
            juniorAprBps: 1_500
        });
    }
}
