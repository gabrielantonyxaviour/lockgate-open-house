// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {CoreFixture} from "./Support.sol";
import {QueueKind} from "../../src/interfaces/IQueueAdapter.sol";
import {IIssuerFund} from "../../src/interfaces/IIssuerFund.sol";
import {ILockgateCreditLine} from "../../src/interfaces/ILockgateCreditLine.sol";
import {PlatformConfig} from "../../src/core/PlatformConfig.sol";
import {PlatformStore} from "../../src/core/PlatformStore.sol";
import {WeeklyCyclePlatform} from "../../src/core/WeeklyCyclePlatform.sol";
import {EpochQueuePlatform} from "../../src/core/EpochQueuePlatform.sol";
import {QuarterlyWindowPlatform} from "../../src/core/QuarterlyWindowPlatform.sol";

contract QueuesTest is CoreFixture {
    address internal alice;
    address internal bob;
    address internal cara;

    function setUp() public {
        _core();
        alice = makeAddr("alice");
        bob = makeAddr("bob");
        cara = makeAddr("cara");
    }

    function test_weeklyFifoPaysWholeRequestsAndDoesNotSkip() public {
        WeeklyCyclePlatform platform = _seedWeekly();
        _queueThree(platform);
        (, uint256 repayFirst, uint256 payable_, uint256 shortfall) = platform.previewSettlement();
        assertEq(repayFirst, 0);
        assertEq(payable_, 100e6);
        assertEq(shortfall, 200e6);
        vm.warp(platform.nextWindow());
        platform.processWindow();
        assertEq(platform.currentCycleId(), 2);
        assertEq(uint256(platform.getRequest(1).status), uint256(IIssuerFund.RequestStatus.Paid));
        assertEq(uint256(platform.getRequest(2).status), uint256(IIssuerFund.RequestStatus.Queued));
        assertEq(platform.cash(), 50e6);
        assertEq(platform.queuedValue(), 200e6);
        assertEq(usdg.balanceOf(alice), 100e6);
    }

    function test_fifoDoesNotSkipALaterSmallerRequest() public {
        WeeklyCyclePlatform platform = _direct(QueueKind.WeeklyCycle, issuer, 110e18);
        vm.prank(issuer);
        platform.setAllowlist(bob, true);
        address share = platform.share();
        vm.prank(issuer);
        IERC20(share).transfer(bob, 10e18);
        _mint(issuer, 50e6);
        vm.startPrank(issuer);
        usdg.approve(address(platform), 50e6);
        platform.depositCash(50e6);
        platform.requestRedeem(100e18);
        vm.stopPrank();
        vm.prank(bob);
        platform.requestRedeem(10e18);
        vm.warp(platform.nextWindow());
        platform.processWindow();
        assertEq(platform.cash(), 50e6);
        assertEq(uint256(platform.getRequest(1).status), uint256(IIssuerFund.RequestStatus.Queued));
        assertEq(uint256(platform.getRequest(2).status), uint256(IIssuerFund.RequestStatus.Queued));
        assertEq(platform.currentCycleId(), 2);
    }

    function test_epochPaysProRata() public {
        vm.prank(issuer);
        EpochQueuePlatform platform = EpochQueuePlatform(
            factory.createPlatform(QueueKind.Epoch, "Epoch book", 600, 1e6, 1_000_000e6, 0)
        );
        _queueThree(WeeklyCyclePlatform(address(platform)));
        (, , uint256 payable_, uint256 shortfall) = platform.previewSettlement();
        assertEq(payable_, 150e6);
        assertEq(shortfall, 150e6);
        vm.warp(platform.nextWindow());
        platform.processWindow();
        assertEq(usdg.balanceOf(alice), 50e6);
        assertEq(usdg.balanceOf(bob), 50e6);
        assertEq(usdg.balanceOf(cara), 50e6);
        assertEq(platform.cash(), 0);
        assertEq(platform.queuedValue(), 150e6);
        assertEq(uint256(platform.getRequest(1).status), uint256(IIssuerFund.RequestStatus.Queued));
        assertEq(platform.getRequest(1).navValue, 50e6);
    }

    function test_quarterlyGateFreezesSettlementWeeklyGateDoesNot() public {
        QuarterlyWindowPlatform quarterly = QuarterlyWindowPlatform(address(_direct(QueueKind.QuarterlyGated, alice, 10e18)));
        vm.prank(issuer);
        quarterly.setGated(true);
        vm.prank(alice);
        vm.expectRevert(PlatformStore.Gated.selector);
        quarterly.requestRedeem(10e18);
        _mint(bob, 5e6);
        vm.startPrank(bob);
        usdg.approve(address(quarterly), 5e6);
        uint256 shares = quarterly.deposit(5e6);
        vm.stopPrank();
        assertGt(shares, 0);
        vm.prank(issuer);
        quarterly.setGated(false);
        vm.prank(alice);
        quarterly.requestRedeem(10e18);
        vm.prank(issuer);
        quarterly.setGated(true);
        _mint(issuer, 5e6);
        vm.startPrank(issuer);
        usdg.approve(address(quarterly), 5e6);
        quarterly.depositCash(5e6);
        vm.stopPrank();
        vm.warp(quarterly.nextWindow());
        vm.expectRevert(PlatformStore.WindowGated.selector);
        quarterly.processWindow();
        vm.prank(issuer);
        quarterly.setGated(false);
        quarterly.processWindow();
        assertEq(uint256(quarterly.getRequest(1).status), uint256(IIssuerFund.RequestStatus.Paid));

        WeeklyCyclePlatform weekly = _seedWeekly();
        _queueThree(weekly);
        vm.prank(issuer);
        weekly.setGated(true);
        vm.warp(weekly.nextWindow());
        weekly.processWindow();
        assertEq(uint256(weekly.getRequest(1).status), uint256(IIssuerFund.RequestStatus.Paid));
    }

    function test_repayFirstBeforeQueueAndUnpaidAdvanceDoesNotRoll() public {
        WeeklyCyclePlatform platform = _direct(QueueKind.WeeklyCycle, issuer, 200e18);
        _post(address(platform), 20e6);
        vm.prank(issuer);
        (uint256 requestId, uint256 out) = platform.exitNow(100e18, 0);
        assertEq(out, 99_010_000);
        assertEq(line.earnedFees(), 0);
        vm.prank(issuer);
        platform.requestRedeem(100e18);
        uint256 advanceId = platform.getRequest(requestId).advanceId;
        vm.warp(platform.nextWindow());
        platform.processWindow();
        assertEq(platform.currentCycleId(), 1);
        assertEq(line.remainingOf(advanceId), 100e6);
        assertEq(uint256(platform.getRequest(2).status), uint256(IIssuerFund.RequestStatus.Queued));

        _mint(issuer, 100e6);
        vm.startPrank(issuer);
        usdg.approve(address(platform), 100e6);
        platform.depositCash(100e6);
        vm.stopPrank();
        platform.processWindow();
        assertEq(platform.currentCycleId(), 2);
        assertEq(line.remainingOf(advanceId), 0);
        assertEq(line.earnedFees(), 990_000);
        assertEq(uint256(line.getAdvance(advanceId).status), uint256(ILockgateCreditLine.AdvanceStatus.Repaid));
        assertEq(uint256(platform.getRequest(2).status), uint256(IIssuerFund.RequestStatus.Queued));
        assertEq(platform.shareToken().balanceOf(address(platform)), 100e18);
    }

    function test_cancelReturnsSharesAndSlippage() public {
        WeeklyCyclePlatform platform = _direct(QueueKind.WeeklyCycle, alice, 10e18);
        vm.prank(alice);
        uint256 id = platform.requestRedeem(10e18);
        assertEq(platform.headRequestId(), id);
        vm.prank(alice);
        platform.cancel(id);
        assertEq(platform.queueLength(), 0);
        assertEq(IERC20(platform.share()).balanceOf(alice), 10e18);
        vm.prank(alice);
        id = platform.requestRedeem(10e18);
        _post(address(platform), 2e6);
        vm.prank(alice);
        vm.expectRevert(PlatformStore.Slippage.selector);
        platform.exitEarly(id, type(uint256).max);
    }

    function _seedWeekly() internal returns (WeeklyCyclePlatform platform) {
        vm.prank(issuer);
        platform = WeeklyCyclePlatform(factory.createPlatform(QueueKind.WeeklyCycle, "Weekly book", 600, 1e6, 1, 0));
    }

    function _queueThree(WeeklyCyclePlatform platform) internal {
        address[3] memory people = [alice, bob, cara];
        for (uint256 i; i < 3; ++i) {
            _mint(people[i], 50e6);
            vm.startPrank(people[i]);
            usdg.approve(address(platform), 50e6);
            platform.deposit(50e6);
            vm.stopPrank();
        }
        vm.prank(issuer);
        platform.setNav(2e6);
        for (uint256 i; i < 3; ++i) {
            vm.prank(people[i]);
            platform.requestRedeem(50e18);
        }
    }

    function _direct(QueueKind kind, address holder, uint256 shares) internal returns (WeeklyCyclePlatform platform) {
        PlatformConfig memory cfg = PlatformConfig({
            token: address(usdg),
            creditLine: address(line),
            reserve: address(reserve),
            issuer: issuer,
            name: "Direct book",
            nav: 1e6,
            interval: 600,
            initialHolder: holder,
            initialShares: shares
        });
        if (kind == QueueKind.Epoch) platform = WeeklyCyclePlatform(address(new EpochQueuePlatform(cfg)));
        else if (kind == QueueKind.QuarterlyGated) platform = WeeklyCyclePlatform(address(new QuarterlyWindowPlatform(cfg)));
        else platform = new WeeklyCyclePlatform(cfg);
        vm.prank(owner);
        line.registerSource(address(platform), 1_000_000e6, 750);
    }
}
