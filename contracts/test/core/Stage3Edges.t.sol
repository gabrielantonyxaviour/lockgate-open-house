// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC20Errors} from "@openzeppelin/contracts/interfaces/draft-IERC6093.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {CoreFixture, StubSource} from "./Support.sol";
import {ILockgateCreditLine} from "../../src/interfaces/ILockgateCreditLine.sol";
import {CreditLineAdmin} from "../../src/core/CreditLineAdmin.sol";
import {CreditLineBook} from "../../src/facility/CreditLineBook.sol";

/// @notice Stage-3 reads of the stage-1 book: one repayment, concurrent advances, a drained reserve, pause.
contract Stage3EdgesTest is CoreFixture {
    StubSource internal stub;
    CreditLineBook internal book;

    function setUp() public {
        _core();
        stub = _stub(1_000_000e6, 750);
        book = new CreditLineBook(address(line));
    }

    function test_partialRepaymentClearsOneAdvance() public {
        _post(address(stub), 20e6);
        (uint256 first, uint256 firstFee) = stub.draw(100e6, investor, type(uint256).max);
        assertEq(firstFee, 990_000);
        stub.poke();
        (uint256 second,) = stub.draw(40e6, investor, type(uint256).max);
        assertEq(line.remainingOf(first), 100e6);
        assertEq(line.remainingOf(second), 40e6);
        assertEq(line.eligibleOutstanding(), 140e6);
        assertEq(book.eligibleOutstanding(), 140e6);
        assertEq(book.lateOutstanding(), 0);

        uint256 exposureBefore = line.exposure(address(stub));
        _mint(address(stub), 100e6 - 1);
        vm.expectRevert(
            abi.encodeWithSelector(IERC20Errors.ERC20InsufficientBalance.selector, address(stub), 100e6 - 1, 100e6)
        );
        line.repay(first);
        assertEq(line.remainingOf(first), 100e6);
        assertEq(line.remainingOf(second), 40e6);
        assertEq(line.exposure(address(stub)), exposureBefore);
        assertEq(line.eligibleOutstanding(), 140e6);
        assertEq(line.earnedFees(), 0);
        assertEq(_code(first), uint256(ILockgateCreditLine.AdvanceStatus.Active));

        _mint(address(stub), 1);
        line.repay(first);
        assertEq(_code(first), uint256(ILockgateCreditLine.AdvanceStatus.Repaid));
        assertEq(line.remainingOf(first), 0);
        assertEq(_code(second), uint256(ILockgateCreditLine.AdvanceStatus.Active));
        assertEq(line.remainingOf(second), 40e6);
        assertEq(line.eligibleOutstanding(), 40e6);
        assertEq(book.eligibleOutstanding(), 40e6);
        assertEq(line.lateOutstanding(), 0);
        assertEq(book.lateOutstanding(), 0);
        assertEq(line.earnedFees(), firstFee);
        assertEq(line.exposure(address(stub)), 40e6);
    }

    function test_concurrentAdvancesStayIndependent() public {
        _post(address(stub), 30e6);
        (uint256 first,) = stub.draw(100e6, investor, type(uint256).max);
        uint64 due1 = line.getAdvance(first).dueAt;
        vm.warp(uint256(due1) - 500);
        stub.poke();
        (uint256 second,) = stub.draw(50e6, investor, type(uint256).max);
        uint64 due2 = line.getAdvance(second).dueAt;
        vm.warp(uint256(due2) - 500);
        stub.poke();
        (uint256 third,) = stub.draw(25e6, investor, type(uint256).max);
        uint64 due3 = line.getAdvance(third).dueAt;

        assertLt(due1, due2);
        assertLt(due2, due3);
        assertEq(line.advancesOf(address(stub)).length, 3);
        assertEq(line.remainingOf(first), 100e6);
        assertEq(line.remainingOf(second), 50e6);
        assertEq(line.remainingOf(third), 25e6);
        assertEq(line.eligibleOutstanding(), 175e6);
        assertEq(book.eligibleOutstanding(), 175e6);

        _mint(address(stub), 50e6);
        line.repay(second);
        assertEq(_code(second), uint256(ILockgateCreditLine.AdvanceStatus.Repaid));
        assertEq(line.remainingOf(second), 0);
        assertEq(_code(first), uint256(ILockgateCreditLine.AdvanceStatus.Active));
        assertEq(_code(third), uint256(ILockgateCreditLine.AdvanceStatus.Active));
        assertEq(line.remainingOf(first), 100e6);
        assertEq(line.remainingOf(third), 25e6);
        assertEq(line.eligibleOutstanding(), 125e6);
        assertEq(book.eligibleOutstanding(), 125e6);
        assertEq(line.lateOutstanding(), 0);
        assertEq(book.lateOutstanding(), 0);
        assertEq(line.exposure(address(stub)), 125e6);
    }

    function test_reserveExhaustionLeavesTheShortfallLate() public {
        _post(address(stub), 7_500_000);
        (uint256 id, uint256 fee) = stub.draw(100e6, investor, type(uint256).max);
        assertEq(fee, 990_000);
        assertEq(line.requiredReserve(address(stub)), 7_500_000);
        vm.expectRevert(CreditLineAdmin.ReserveShort.selector);
        stub.draw(1e6, investor, type(uint256).max);
        assertEq(line.advanceCount(), 1);
        assertEq(line.exposure(address(stub)), 100e6);
        assertEq(reserve.balanceOf(address(stub)), 7_500_000);

        uint64 due = line.getAdvance(id).dueAt;
        vm.warp(uint256(due) + line.graceOf(id));
        line.markLate(id);
        assertEq(reserve.balanceOf(address(stub)), 0);
        assertEq(line.eligibleOutstanding(), 0);
        assertEq(book.eligibleOutstanding(), 0);
        assertEq(line.lateOutstanding(), 92_500_000);
        assertEq(book.lateOutstanding(), 92_500_000);
        assertEq(line.requiredReserve(address(stub)), 6_937_500);
        assertEq(line.earnedFees(), 0);
        stub.poke();
        (,,, string memory why) = line.quote(address(stub), 1e6);
        assertEq(why, "reserve");

        _mint(address(stub), 92_500_000);
        line.repay(id);
        assertEq(_code(id), uint256(ILockgateCreditLine.AdvanceStatus.Late));
        assertEq(line.remainingOf(id), 0);
        assertEq(line.exposure(address(stub)), 0);
        assertEq(line.requiredReserve(address(stub)), 0);
        assertEq(line.lateOutstanding(), 0);
        assertEq(book.lateOutstanding(), 0);
        assertEq(line.eligibleOutstanding(), 0);
        assertEq(line.earnedFees(), fee);
        assertEq(line.reserveFloorBps(address(stub)), 750);
    }

    function test_pauseStopsDrawsAndLeavesEmergencyCollection() public {
        _post(address(stub), 15e6);
        (uint256 first,) = stub.draw(100e6, investor, type(uint256).max);
        stub.poke();
        (uint256 second,) = stub.draw(100e6, investor, type(uint256).max);
        assertEq(line.eligibleOutstanding(), 200e6);
        assertEq(book.eligibleOutstanding(), 200e6);

        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger));
        line.pause();
        vm.prank(owner);
        line.pause();
        assertTrue(line.paused());
        assertEq(line.eligibleOutstanding(), 200e6);
        assertEq(book.eligibleOutstanding(), 200e6);
        assertEq(line.exposure(address(stub)), 200e6);
        (,,, string memory pausedWhy) = line.quote(address(stub), 1e6);
        assertEq(pausedWhy, "paused");
        vm.expectRevert(Pausable.EnforcedPause.selector);
        stub.draw(1e6, investor, type(uint256).max);

        uint64 due = line.getAdvance(first).dueAt;
        vm.warp(uint256(due) + line.graceOf(first));
        vm.prank(stranger);
        line.markLate(first);
        assertEq(reserve.balanceOf(address(stub)), 0);
        assertEq(line.lateOutstanding(), 85e6);
        assertEq(book.lateOutstanding(), 85e6);
        assertEq(line.eligibleOutstanding(), 100e6);
        assertEq(book.eligibleOutstanding(), 100e6);
        assertEq(line.remainingOf(first), 85e6);
        assertEq(line.remainingOf(second), 100e6);
        assertEq(_code(first), uint256(ILockgateCreditLine.AdvanceStatus.Late));
        assertEq(_code(second), uint256(ILockgateCreditLine.AdvanceStatus.Active));

        _mint(address(stub), 100e6);
        line.repay(second);
        assertEq(_code(second), uint256(ILockgateCreditLine.AdvanceStatus.Repaid));
        assertEq(line.eligibleOutstanding(), 0);
        assertEq(line.lateOutstanding(), 85e6);
        assertEq(book.lateOutstanding(), 85e6);
        assertEq(line.remainingOf(first), 85e6);

        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger));
        line.unpause();
        _mint(issuer, 6_450_000);
        vm.startPrank(issuer);
        usdg.approve(address(line), 6_450_000);
        line.postReserve(address(stub), 6_450_000);
        vm.stopPrank();
        assertTrue(line.paused());
        assertEq(reserve.balanceOf(address(stub)), 6_450_000);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        stub.draw(1e6, investor, type(uint256).max);

        vm.prank(owner);
        line.unpause();
        assertFalse(line.paused());
        stub.poke();
        (uint256 third,) = stub.draw(1e6, investor, type(uint256).max);
        assertEq(line.remainingOf(third), 1e6);
        assertEq(_code(third), uint256(ILockgateCreditLine.AdvanceStatus.Active));
        assertEq(line.eligibleOutstanding(), 1e6);
        assertEq(book.eligibleOutstanding(), 1e6);
        assertEq(line.lateOutstanding(), 85e6);
        assertEq(book.lateOutstanding(), 85e6);
        assertEq(line.remainingOf(first), 85e6);
        assertEq(_code(first), uint256(ILockgateCreditLine.AdvanceStatus.Late));
    }

    /// @notice Pause and resume with two open advances. The book is the same on both sides.
    function test_pauseAndResumeLeaveTheOpenBook() public {
        _post(address(stub), 15e6);
        (uint256 openId,) = stub.draw(100e6, investor, type(uint256).max);
        stub.poke();
        (uint256 lateId,) = stub.draw(40e6, investor, type(uint256).max);
        uint64 due = line.getAdvance(lateId).dueAt;
        assertEq(line.getAdvance(openId).dueAt, due);

        vm.warp(uint256(due) + line.graceOf(lateId));
        line.markLate(lateId);
        uint256 lineCash = line.capital();
        uint256 investorCash = usdg.balanceOf(investor);
        uint256 unpaid = line.outstanding();
        (,,, string memory why) = line.quote(address(stub), 1e6);
        assertEq(why, "window due");
        _frozenBook(openId, lateId, due, unpaid);

        vm.prank(owner);
        line.pause();
        assertTrue(line.paused());
        vm.expectRevert(Pausable.EnforcedPause.selector);
        stub.draw(1e6, investor, type(uint256).max);
        (,,, why) = line.quote(address(stub), 1e6);
        assertEq(why, "paused");

        vm.warp(uint256(due) + line.graceOf(openId) + 1 days);
        _frozenBook(openId, lateId, due, unpaid);
        assertEq(line.capital(), lineCash);
        assertEq(usdg.balanceOf(investor), investorCash);
        assertEq(line.advanceCount(), 2);

        vm.prank(owner);
        line.unpause();
        assertFalse(line.paused());
        _frozenBook(openId, lateId, due, unpaid);
        assertEq(line.capital(), lineCash);
        assertEq(usdg.balanceOf(investor), investorCash);
        (,,, why) = line.quote(address(stub), 1e6);
        assertEq(why, "window due");
    }

    function _frozenBook(uint256 openId, uint256 lateId, uint64 due, uint256 unpaid) internal view {
        uint256 openPrincipal = line.getAdvance(openId).principal;
        uint256 latePrincipal = line.getAdvance(lateId).principal;
        assertEq(openPrincipal, 99_010_000);
        assertGt(latePrincipal, 15e6);
        assertEq(unpaid, openPrincipal + latePrincipal - 15e6);
        assertEq(line.outstanding(), unpaid);
        assertEq(line.earnedFees(), 0);
        assertEq(line.deposited(), 500_000e6);
        assertEq(line.withdrawn(), 0);
        assertEq(line.eligibleOutstanding(), 100e6);
        assertEq(book.eligibleOutstanding(), 100e6);
        assertEq(line.lateOutstanding(), 25e6);
        assertEq(book.lateOutstanding(), 25e6);
        assertEq(line.exposure(address(stub)), 125e6);
        assertEq(line.totalExposure(), 125e6);
        assertEq(line.remainingOf(openId), 100e6);
        assertEq(line.remainingOf(lateId), 25e6);
        assertEq(line.recoveredOf(openId), 0);
        assertEq(line.recoveredOf(lateId), 15e6);
        assertEq(line.requiredReserve(address(stub)), 9_375_000);
        assertEq(line.reserveFloorBps(address(stub)), 750);
        assertEq(reserve.balanceOf(address(stub)), 0);
        assertEq(reserve.tokenBalance(), 0);
        assertEq(line.getAdvance(openId).fee, 990_000);
        assertEq(line.getAdvance(openId).dueAt, due);
        assertEq(line.getAdvance(lateId).dueAt, due);
        assertEq(line.graceOf(openId), 1 days);
        assertEq(line.graceOf(lateId), 1 days);
        assertEq(_code(openId), uint256(ILockgateCreditLine.AdvanceStatus.Active));
        assertEq(_code(lateId), uint256(ILockgateCreditLine.AdvanceStatus.Late));
        assertEq(line.accountedAssets(), line.accountedEquity());
    }

    function _code(uint256 id) internal view returns (uint256) {
        return uint256(line.getAdvance(id).status);
    }
}
