// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {CreditFacility} from "../../src/facility/CreditFacility.sol";
import {FacilityStore} from "../../src/facility/FacilityStore.sol";
import {MockBook} from "../facility/mocks/MockBook.sol";

/// @notice One facility draw and repay on a local fork of Arbitrum Sepolia USDG.
///         Nothing is broadcast. The book is a local stand-in. The token is canonical.
///         RPC: https://sepolia-rollup.arbitrum.io/rpc
///         Token: https://sepolia.arbiscan.io/token/0xFFC95faa3d63Cde504a05B567C600B78C0b41892
contract SepoliaFacility is Test {
    address internal constant USDG = 0xFFC95faa3d63Cde504a05B567C600B78C0b41892;
    uint256 internal constant U = 1e6;

    IERC20 internal token;
    CreditFacility internal facility;
    address internal governor;
    address internal borrower;
    address internal senior;
    address internal stranger = makeAddr("stranger");

    function setUp() public {
        vm.createSelectFork("https://sepolia-rollup.arbitrum.io/rpc");
        token = IERC20(USDG);
        governor = makeAddr("governor");
        borrower = makeAddr("borrower");
        senior = makeAddr("senior");
        MockBook book = new MockBook();
        book.set(1_000_000 * U, 0);
        facility = new CreditFacility(
            FacilityStore.Init({
                governor: governor,
                borrower: borrower,
                asset: USDG,
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
        vm.prank(governor);
        facility.approveLender(senior, true);
        deal(USDG, senior, 100 * U);
        vm.startPrank(senior);
        token.approve(address(facility), type(uint256).max);
        facility.deposit(FacilityStore.Tranche.Senior, 100 * U);
        vm.stopPrank();
    }

    function test_drawAndRepayStayInsideTheFacility() public {
        assertEq(block.chainid, 421_614);
        assertEq(facility.asset(), USDG);
        uint256 supply = token.totalSupply();
        assertEq(facility.accounting().cash, 100 * U);
        assertEq(facility.accounting().drawn, 0);

        vm.prank(stranger);
        vm.expectRevert(FacilityStore.Unauthorized.selector);
        facility.draw(1);
        assertEq(token.balanceOf(stranger), 0);
        assertEq(facility.accounting().drawn, 0);

        vm.prank(borrower);
        facility.draw(40 * U);
        assertEq(token.balanceOf(borrower), 40 * U);
        assertEq(facility.accounting().drawn, 40 * U);
        assertEq(facility.accounting().cash, 60 * U);
        assertEq(token.balanceOf(address(facility)), 60 * U);
        assertEq(token.totalSupply(), supply);
        assertTrue(facility.solvent());

        vm.startPrank(borrower);
        token.approve(address(facility), 40 * U);
        facility.repay(40 * U);
        vm.stopPrank();
        assertEq(token.balanceOf(borrower), 0);
        assertEq(facility.accounting().drawn, 0);
        assertEq(facility.accounting().cash, 100 * U);
        assertEq(token.balanceOf(address(facility)), 100 * U);
        assertEq(token.totalSupply(), supply);
        assertTrue(facility.solvent());
    }
}
