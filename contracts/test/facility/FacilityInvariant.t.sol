// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {CreditFacility} from "../../src/facility/CreditFacility.sol";
import {FacilityStore} from "../../src/facility/FacilityStore.sol";
import {MockUSDG} from "../partner/mocks/ReenterUSDG.sol";
import {MockBook} from "./mocks/MockBook.sol";

contract FacilityHandler is Test {
    CreditFacility public facility;
    MockUSDG public usdg;
    address public governor;
    address public borrower;
    address[4] public lenders;

    constructor() {
        governor = makeAddr("governor");
        borrower = makeAddr("borrower");
        usdg = new MockUSDG();
        MockBook book = new MockBook();
        book.set(1_000_000e6, 0);
        facility = new CreditFacility(
            FacilityStore.Init({
                governor: governor,
                borrower: borrower,
                asset: address(usdg),
                book: address(book),
                oracle: address(0),
                minPriceE8: 0,
                maxOracleAge: 0,
                advanceRateBps: 8_000,
                maxLateBps: 2_000,
                minJuniorBps: 1_000,
                seniorAprBps: 500,
                juniorAprBps: 800
            })
        );
        for (uint256 i; i < lenders.length; ++i) {
            lenders[i] = address(uint160(0xA100 + i));
            vm.prank(governor);
            facility.approveLender(lenders[i], true);
        }
    }

    function deposit(uint8 who, bool senior, uint96 assets) external {
        address lender = lenders[who % lenders.length];
        uint256 amt = bound(assets, 1e6, 100_000e6);
        usdg.mint(lender, amt);
        vm.startPrank(lender);
        usdg.approve(address(facility), amt);
        try facility.deposit(senior ? FacilityStore.Tranche.Senior : FacilityStore.Tranche.Junior, amt) {} catch {}
        vm.stopPrank();
    }

    function redeem(uint8 who, bool senior, uint96 sharesRaw) external {
        address lender = lenders[who % lenders.length];
        uint256 bal = senior ? facility.seniorShares(lender) : facility.juniorShares(lender);
        if (bal == 0) return;
        uint256 shares = bound(sharesRaw, 1, bal);
        vm.prank(lender);
        try facility.redeem(senior ? FacilityStore.Tranche.Senior : FacilityStore.Tranche.Junior, shares) {} catch {}
    }

    function draw(uint96 amount) external {
        uint256 room = facility.availableDraw();
        if (room == 0) return;
        uint256 amt = bound(amount, 1, room);
        vm.prank(borrower);
        try facility.draw(amt) {} catch {}
    }

    function repay(uint96 amount) external {
        uint256 amt = bound(amount, 1, 200_000e6);
        usdg.mint(borrower, amt);
        vm.startPrank(borrower);
        usdg.approve(address(facility), amt);
        try facility.repay(amt) {} catch {}
        vm.stopPrank();
    }

    function warp(uint32 dt) external {
        vm.warp(block.timestamp + bound(dt, 1, 10 days));
    }

    function poke() external {
        try facility.poke() {} catch {}
    }

    function recognize() external {
        try facility.recognizeLoss() {} catch {}
    }
}

contract FacilityInvariantTest is Test {
    FacilityHandler internal handler;

    function setUp() public {
        handler = new FacilityHandler();
        targetContract(address(handler));
    }

    function invariant_solventCashAndCap() public view {
        CreditFacility facility = handler.facility();
        assertTrue(facility.solvent());
        assertEq(handler.usdg().balanceOf(address(facility)), facility.accounting().cash);
        assertLe(facility.lenderCount(), facility.MAX_LENDERS());
        assertLe(facility.availableDraw(), facility.accounting().cash);
    }
}
