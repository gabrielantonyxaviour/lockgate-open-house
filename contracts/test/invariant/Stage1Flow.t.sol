// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {MockUSDG} from "../../src/core/MockUSDG.sol";
import {UsdgAdapter} from "../../src/core/UsdgAdapter.sol";
import {PricingEngine} from "../../src/core/PricingEngine.sol";
import {PlatformReserve} from "../../src/core/PlatformReserve.sol";
import {CreditLineAdmin} from "../../src/core/CreditLineAdmin.sol";
import {LockgateCreditLine} from "../../src/core/LockgateCreditLine.sol";
import {CreditLineBook} from "../../src/facility/CreditLineBook.sol";
import {CreditActor} from "./mocks/CreditActor.sol";

/// @notice Scripted stage-1 paths: 600s quote, repay-first, gate, pause, and the facility book.
contract Stage1Flow is Test {
    uint256 internal constant U = 1e6;
    uint256 internal constant NAV = 10_000 * U;

    MockUSDG internal token;
    LockgateCreditLine internal line;
    CreditActor internal actor;
    address internal investor;
    address internal stranger = makeAddr("stranger");

    function setUp() public {
        token = new MockUSDG(address(this));
        UsdgAdapter adapter = new UsdgAdapter(address(token), true);
        PricingEngine pricing = new PricingEngine(address(this));
        PlatformReserve reserve = new PlatformReserve(address(this), address(adapter));
        line = new LockgateCreditLine(address(this), address(adapter), address(pricing), address(reserve));
        reserve.setCreditLine(address(line));
        reserve.setSlasher(address(line), true);
        investor = makeAddr("investor");
        actor = new CreditActor(line, token, investor);
        line.registerSource(address(actor), 1_000_000 * U, 750);
        token.mint(address(this), 200_000 * U);
        token.approve(address(line), type(uint256).max);
        line.depositCapital(200_000 * U);
        token.mint(address(actor), 20_000 * U);
        actor.postReserve(20_000 * U);
        actor.refresh(600);
    }

    function test_tenMinuteWaitQuotes99Bps() public view {
        (uint256 fee, uint16 bps, bool available, string memory reason) = line.quote(address(actor), NAV);
        assertTrue(available, reason);
        assertEq(bps, 99);
        assertEq(fee, 99 * U);
    }

    function test_weekLongWaitIsRefusedNotClamped() public {
        actor.refresh(uint64(7 days));
        (,, bool available, string memory reason) = line.quote(address(actor), NAV);
        assertFalse(available);
        assertEq(reason, "fee above max");
    }

    function test_repayPullsThePlatformAndLeavesTheInvestor() public {
        uint256 investorBefore = token.balanceOf(investor);
        (uint256 id, uint256 fee) = actor.draw(NAV);
        uint256 principal = NAV - fee;
        assertEq(token.balanceOf(investor), investorBefore + principal);
        assertEq(token.balanceOf(address(actor)), 0);

        token.mint(address(actor), NAV);
        uint256 investorAtRepay = token.balanceOf(investor);
        actor.repay(id);
        assertEq(token.balanceOf(investor), investorAtRepay);
        assertEq(line.outstanding(), 0);
        assertEq(line.earnedFees(), fee);
        assertEq(line.remainingOf(id), 0);
    }

    function test_gateAndPauseBlockDraws() public {
        actor.setGated(true);
        vm.expectRevert(CreditLineAdmin.Gated.selector);
        actor.draw(NAV);
        actor.refresh(600);

        line.pause();
        vm.expectRevert();
        actor.draw(NAV);
        token.mint(address(actor), NAV);
        (uint256 id,) = _drawUnpaused();
        line.pause();
        actor.repay(id);
        assertEq(line.outstanding(), 0);
    }

    function test_strangerCannotMoveCapital() public {
        vm.prank(stranger);
        vm.expectRevert();
        line.withdrawCapital(1);
        vm.prank(stranger);
        vm.expectRevert();
        line.depositCapital(1);
    }

    function test_creditLineBookReadsTheStage1Line() public {
        actor.draw(NAV);
        CreditLineBook book = new CreditLineBook(address(line));
        assertEq(book.eligibleOutstanding(), NAV);
        assertEq(book.lateOutstanding(), 0);
        assertEq(book.eligibleOutstanding(), line.eligibleOutstanding());
        assertEq(book.lateOutstanding(), line.lateOutstanding());
        assertEq(book.eligibleOutstanding() + book.lateOutstanding(), line.totalExposure());
    }

    function _drawUnpaused() internal returns (uint256 id, uint256 fee) {
        line.unpause();
        actor.refresh(600);
        return actor.draw(NAV);
    }
}
