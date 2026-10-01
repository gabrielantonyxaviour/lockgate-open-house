// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {CreditFacility} from "../../src/facility/CreditFacility.sol";
import {FacilityStore} from "../../src/facility/FacilityStore.sol";
import {MockUSDG} from "../partner/mocks/MockUSDG.sol";
import {MockBook} from "./mocks/MockBook.sol";

contract FacilityFixture is Test {
    MockUSDG internal usdg;
    MockBook internal book;
    CreditFacility internal facility;
    address internal governor;
    address internal borrower;
    address internal senior;
    address internal junior;

    function _open(
        uint16 advanceBps,
        uint16 maxLateBps,
        uint16 minJuniorBps,
        uint64 seniorApr,
        uint64 juniorApr,
        address oracle,
        uint64 minPrice,
        uint64 maxAge
    ) internal {
        governor = makeAddr("governor");
        borrower = makeAddr("borrower");
        senior = makeAddr("senior");
        junior = makeAddr("junior");
        usdg = new MockUSDG();
        book = new MockBook();
        book.set(1_000_000e6, 0);
        facility = new CreditFacility(
            FacilityStore.Init({
                governor: governor,
                borrower: borrower,
                asset: address(usdg),
                book: address(book),
                oracle: oracle,
                minPriceE8: minPrice,
                maxOracleAge: maxAge,
                advanceRateBps: advanceBps,
                maxLateBps: maxLateBps,
                minJuniorBps: minJuniorBps,
                seniorAprBps: seniorApr,
                juniorAprBps: juniorApr
            })
        );
    }

    function _deposit(address lender, FacilityStore.Tranche tranche, uint256 assets) internal {
        vm.prank(governor);
        facility.approveLender(lender, true);
        usdg.mint(lender, assets);
        vm.startPrank(lender);
        usdg.approve(address(facility), type(uint256).max);
        facility.deposit(tranche, assets);
        vm.stopPrank();
    }
}
