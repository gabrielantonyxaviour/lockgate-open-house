// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {CoreFixture, StubSource} from "./Support.sol";
import {ILockgateCreditLine} from "../../src/interfaces/ILockgateCreditLine.sol";
import {CreditLineAdmin} from "../../src/core/CreditLineAdmin.sol";

contract CreditLineTest is CoreFixture {
    StubSource internal stub;

    function setUp() public {
        _core();
        stub = _stub(1_000_000e6, 750);
        _post(address(stub), 20e6);
    }

    function test_drawPaysNetAndOwesFace() public {
        uint256 investorBefore = usdg.balanceOf(investor);
        (uint256 id, uint256 fee) = stub.draw(100e6, investor, type(uint256).max);
        assertEq(id, 1);
        assertEq(fee, 990_000);
        assertEq(usdg.balanceOf(investor) - investorBefore, 99_010_000);
        ILockgateCreditLine.Advance memory advance = line.getAdvance(id);
        assertEq(advance.principal, 99_010_000);
        assertEq(advance.fee, 990_000);
        assertEq(advance.to, investor);
        assertEq(uint256(advance.status), uint256(ILockgateCreditLine.AdvanceStatus.Active));
        assertEq(line.outstanding(), 99_010_000);
        assertEq(line.exposure(address(stub)), 100e6);
        assertEq(line.eligibleOutstanding(), 100e6);
        assertEq(line.lateOutstanding(), 0);
        assertEq(line.remainingOf(id), 100e6);
        assertEq(line.earnedFees(), 0);
        assertEq(line.accountedAssets(), line.accountedEquity());
        assertEq(uint256(line.utilizationBps()), uint256(99_010_000) * 10_000 / 500_000e6);
    }

    function test_repayRealizesFeeAndAnyoneCanCall() public {
        (uint256 id,) = stub.draw(100e6, investor, type(uint256).max);
        _mint(address(stub), 100e6);
        uint256 callerBefore = usdg.balanceOf(stranger);
        vm.prank(stranger);
        line.repay(id);
        assertEq(usdg.balanceOf(stranger), callerBefore);
        assertEq(line.earnedFees(), 990_000);
        assertEq(line.outstanding(), 0);
        assertEq(line.exposure(address(stub)), 0);
        assertEq(line.eligibleOutstanding(), 0);
        assertEq(line.lateOutstanding(), 0);
        assertEq(line.remainingOf(id), 0);
        assertEq(uint256(line.getAdvance(id).status), uint256(ILockgateCreditLine.AdvanceStatus.Repaid));
        assertEq(line.accountedAssets(), line.accountedEquity());
        vm.expectRevert(CreditLineAdmin.BadStatus.selector);
        line.repay(id);
    }

    function test_partialSlashThenCureStaysLate() public {
        vm.prank(address(stub));
        reserve.setAdmin(address(stub), issuer);
        vm.prank(issuer);
        reserve.withdraw(address(stub), 20e6);
        _post(address(stub), 50e6);
        (uint256 id,) = stub.draw(100e6, investor, type(uint256).max);
        vm.warp(line.getAdvance(id).dueAt + line.grace());
        vm.prank(stranger);
        line.markLate(id);
        assertEq(uint256(line.getAdvance(id).status), uint256(ILockgateCreditLine.AdvanceStatus.Late));
        assertEq(line.remainingOf(id), 50e6);
        assertEq(line.eligibleOutstanding(), 0);
        assertEq(line.lateOutstanding(), 50e6);
        assertEq(line.earnedFees(), 0);
        assertEq(reserve.balanceOf(address(stub)), 0);
        _mint(address(stub), 50e6);
        line.repay(id);
        assertEq(line.earnedFees(), 990_000);
        assertEq(line.remainingOf(id), 0);
        assertEq(line.lateOutstanding(), 0);
        assertEq(uint256(line.getAdvance(id).status), uint256(ILockgateCreditLine.AdvanceStatus.Late));
        assertEq(line.accountedAssets(), line.accountedEquity());
    }

    function test_graceBoundaryAndFullSlash() public {
        (uint256 id,) = stub.draw(100e6, investor, type(uint256).max);
        uint64 due = line.getAdvance(id).dueAt;
        vm.warp(uint256(due) + line.grace() - 1);
        vm.expectRevert(CreditLineAdmin.TooEarly.selector);
        line.markLate(id);
        vm.warp(uint256(due) + line.grace());
        _post(address(stub), 100e6);
        line.markLate(id);
        assertEq(line.remainingOf(id), 0);
        assertEq(line.earnedFees(), 990_000);
        assertEq(line.eligibleOutstanding(), 0);
        assertEq(line.lateOutstanding(), 0);
        assertEq(uint256(line.getAdvance(id).status), uint256(ILockgateCreditLine.AdvanceStatus.Late));
        vm.expectRevert(CreditLineAdmin.BadStatus.selector);
        line.markLate(id);
    }

    function test_pauseBlocksDrawNotRepay() public {
        (uint256 id,) = stub.draw(100e6, investor, type(uint256).max);
        vm.prank(owner);
        line.pause();
        (,,, string memory why) = line.quote(address(stub), 100e6);
        assertEq(why, "paused");
        vm.expectRevert(Pausable.EnforcedPause.selector);
        stub.draw(100e6, investor, type(uint256).max);
        _mint(address(stub), 100e6);
        line.repay(id);
        assertEq(line.earnedFees(), 990_000);
    }

    function test_accessAndReregister() public {
        vm.prank(stranger);
        vm.expectRevert(CreditLineAdmin.NotRegistrar.selector);
        line.registerSource(stranger, 1, 0);
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger));
        line.setSourceTerms(address(stub), 1, 0, 0);
        vm.prank(owner);
        line.setSourceTerms(address(stub), 2_000_000e6, 500, 100);
        assertEq(line.sources().length, 1);
        vm.prank(owner);
        line.registerSource(address(stub), 2_000_000e6, 500);
        assertEq(line.sources().length, 1);
        stub.draw(1e6, investor, type(uint256).max);
        vm.prank(owner);
        vm.expectRevert(CreditLineAdmin.StillExposed.selector);
        line.deregisterSource(address(stub));
    }

    function test_bookSplitsActiveFromLate() public {
        (uint256 first,) = stub.draw(100e6, investor, type(uint256).max);
        stub.poke();
        stub.draw(40e6, investor, type(uint256).max);
        assertEq(line.eligibleOutstanding(), 140e6);
        vm.warp(line.getAdvance(first).dueAt + line.grace());
        line.markLate(first);
        assertEq(line.eligibleOutstanding(), 40e6);
        assertEq(line.lateOutstanding(), 80e6);
        assertEq(line.eligibleOutstanding() + line.lateOutstanding(), line.totalExposure());
    }
}
