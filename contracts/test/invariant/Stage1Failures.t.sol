// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {MockUSDG} from "../../src/core/MockUSDG.sol";
import {UsdgAdapter} from "../../src/core/UsdgAdapter.sol";
import {PricingEngine} from "../../src/core/PricingEngine.sol";
import {PlatformReserve} from "../../src/core/PlatformReserve.sol";
import {CreditLineAdmin} from "../../src/core/CreditLineAdmin.sol";
import {LockgateCreditLine} from "../../src/core/LockgateCreditLine.sol";
import {ILockgateCreditLine} from "../../src/interfaces/ILockgateCreditLine.sol";
import {CreditActor} from "./mocks/CreditActor.sol";

/// @notice Quote reasons and the draws they must refuse. A refusal leaves capital where it was.
contract Stage1Failures is Test {
    uint256 internal constant U = 1e6;
    uint256 internal constant NAV = 10_000 * U;
    bytes4 internal constant PAUSED = bytes4(keccak256("EnforcedPause()"));

    MockUSDG internal token;
    LockgateCreditLine internal line;
    CreditActor internal actor;
    address internal investor;

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

    function test_zeroWindowDueAndUnregistered() public {
        _expectQuote(0, "zero");
        vm.expectRevert(CreditLineAdmin.ZeroAmount.selector);
        actor.draw(0);

        actor.refresh(0);
        _expectQuote(NAV, "window due");
        vm.expectRevert(CreditLineAdmin.WindowDue.selector);
        actor.draw(NAV);

        CreditActor other = new CreditActor(line, token, makeAddr("other-investor"));
        (,,, string memory reason) = line.quote(address(other), NAV);
        assertEq(reason, "unregistered");
        vm.expectRevert(CreditLineAdmin.Unregistered.selector);
        other.draw(NAV);
        assertEq(line.advanceCount(), 0);
    }

    function test_navTimeAndStaleBoundary() public {
        actor.setNavUpdatedAt(uint64(block.timestamp + 1));
        _expectQuote(NAV, "bad nav time");
        vm.expectRevert(CreditLineAdmin.BadNavTime.selector);
        actor.draw(NAV);

        vm.warp(8 days);
        actor.refresh(600);
        actor.setNavUpdatedAt(uint64(block.timestamp - 7 days));
        (,, bool available, string memory reason) = line.quote(address(actor), NAV);
        assertTrue(available, reason);

        actor.setNavUpdatedAt(uint64(block.timestamp - 7 days - 1));
        _expectQuote(NAV, "stale nav");
        vm.expectRevert(CreditLineAdmin.StaleNav.selector);
        actor.draw(NAV);
    }

    function test_tenorAndWeekLongFeeAreRefused() public {
        actor.refresh(uint64(366 days + 1));
        _expectQuote(NAV, "tenor");
        vm.expectRevert(CreditLineAdmin.Tenor.selector);
        actor.draw(NAV);

        actor.refresh(uint64(7 days));
        _expectQuote(NAV, "fee above max");
        vm.expectRevert(CreditLineAdmin.FeeAboveMax.selector);
        actor.draw(NAV);
        assertEq(token.balanceOf(investor), 0);
    }

    function test_capsReserveCapitalAndDust() public {
        _expectQuote(1_000_000 * U + 1, "over limit");
        vm.expectRevert(CreditLineAdmin.OverLimit.selector);
        actor.draw(1_000_000 * U + 1);

        _expectQuote(1, "fee consumes value");
        vm.expectRevert(CreditLineAdmin.FeeConsumesValue.selector);
        actor.draw(1);

        CreditActor thin = new CreditActor(line, token, makeAddr("thin"));
        line.registerSource(address(thin), 1_000_000 * U, 1_000);
        thin.refresh(600);
        (,,, string memory reason) = line.quote(address(thin), 1_000 * U);
        assertEq(reason, "reserve");
        vm.expectRevert(CreditLineAdmin.ReserveShort.selector);
        thin.draw(1_000 * U);

        line.setCaps(1, 10_000);
        _expectQuote(NAV, "utilization");
        vm.expectRevert(CreditLineAdmin.UtilizationCap.selector);
        actor.draw(NAV);
        line.setCaps(10_000, 5_000);
        _expectQuote(NAV, "concentration");
        vm.expectRevert(CreditLineAdmin.ConcentrationCap.selector);
        actor.draw(NAV);

        line.setCaps(10_000, 10_000);
        line.withdrawCapital(line.capital() - 1_000 * U);
        _expectQuote(NAV, "capital");
        vm.expectRevert(CreditLineAdmin.CapitalShort.selector);
        actor.draw(NAV);
        assertEq(line.advanceCount(), 0);
    }

    function test_pauseBlocksTheDrawAndNotTheQuoteReason() public {
        line.pause();
        _expectQuote(NAV, "paused");
        vm.expectRevert(PAUSED);
        actor.draw(NAV);
    }

    function test_repayTwiceAndUnknownId() public {
        (uint256 id,) = actor.draw(NAV);
        token.mint(address(actor), NAV);
        actor.repay(id);
        vm.expectRevert(CreditLineAdmin.BadStatus.selector);
        actor.repay(id);
        vm.expectRevert(CreditLineAdmin.UnknownAdvance.selector);
        actor.repay(0);
        vm.expectRevert(CreditLineAdmin.UnknownAdvance.selector);
        line.markLate(type(uint256).max);
        assertEq(line.outstanding(), 0);
    }

    function test_graceBoundaryLeavesAnUncoveredLateBook() public {
        CreditActor bare = new CreditActor(line, token, makeAddr("bare"));
        line.registerSource(address(bare), 1_000_000 * U, 0);
        bare.refresh(600);
        (uint256 id,) = bare.draw(NAV);
        uint64 due = line.getAdvance(id).dueAt;
        vm.warp(uint256(due) + line.grace() - 1);
        vm.expectRevert(CreditLineAdmin.TooEarly.selector);
        line.markLate(id);
        vm.warp(uint256(due) + line.grace());
        line.markLate(id);
        assertEq(uint8(line.getAdvance(id).status), uint8(ILockgateCreditLine.AdvanceStatus.Late));
        assertEq(line.lateOutstanding(), NAV);
        assertEq(line.eligibleOutstanding(), 0);
        assertEq(line.lateOutstanding() + line.eligibleOutstanding(), line.totalExposure());
        assertEq(token.balanceOf(address(bare)), 0);
    }

    /// forge-config: default.fuzz.runs = 512
    function testFuzz_aDrawPaysTheInvestorOrLeavesTheBook(uint128 navSeed, uint64 windowIn, bool gate) public {
        uint256 nav = bound(navSeed, 0, 50_000 * U);
        uint256 countBefore = line.advanceCount();
        uint256 investorBefore = token.balanceOf(investor);
        uint256 lineBefore = token.balanceOf(address(line));
        actor.setGated(gate);
        actor.refresh(uint64(bound(windowIn, 1, 40 days)));
        try actor.draw(nav) returns (uint256, uint256 fee) {
            assertGt(nav, fee);
            assertEq(token.balanceOf(investor), investorBefore + nav - fee);
            assertEq(line.advanceCount(), countBefore + 1);
            assertEq(line.accountedAssets(), line.accountedEquity());
            assertEq(token.balanceOf(address(line)), lineBefore - (nav - fee));
        } catch {
            assertEq(line.advanceCount(), countBefore);
            assertEq(token.balanceOf(investor), investorBefore);
            assertEq(token.balanceOf(address(line)), lineBefore);
        }
    }

    function _expectQuote(uint256 nav, string memory expected) internal view {
        (uint256 fee,, bool available, string memory reason) = line.quote(address(actor), nav);
        assertFalse(available);
        assertEq(reason, expected);
        assertEq(fee, 0);
    }
}
