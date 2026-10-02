// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {CoreFixture} from "./Support.sol";
import {IIssuerFund} from "../../src/interfaces/IIssuerFund.sol";
import {ILockgateCreditLine} from "../../src/interfaces/ILockgateCreditLine.sol";
import {CreditLineAdmin} from "../../src/core/CreditLineAdmin.sol";
import {PlatformConfig} from "../../src/core/PlatformConfig.sol";
import {WeeklyCyclePlatform} from "../../src/core/WeeklyCyclePlatform.sol";

/// @notice A weekly queue that misses its window, then either never pays or pays after grace.
contract QueueReserveTest is CoreFixture {
    uint256 internal constant FACE = 100e6;
    uint256 internal constant POSTED = 7_500_000;
    uint256 internal constant SHORT = 92_500_000;

    function setUp() public {
        _core();
    }

    function test_missedWindowSlashesReserveAndHoldsTheQueue() public {
        (WeeklyCyclePlatform platform, uint256 id, uint64 due) = _book();
        uint256 lineCash = line.capital();
        _openWindow(platform, due, id);

        assertEq(platform.currentCycleId(), 1);
        assertEq(platform.nextWindow(), due);
        assertEq(platform.cash(), 1);
        assertEq(reserve.balanceOf(address(platform)), POSTED);
        assertEq(line.requiredReserve(address(platform)), POSTED);
        assertEq(line.reserveFloorBps(address(platform)), 750);
        assertEq(line.earnedFees(), 0);
        assertEq(uint256(line.getAdvance(id).status), uint256(ILockgateCreditLine.AdvanceStatus.Active));
        _queueHeld(platform, FACE, FACE);

        vm.warp(uint256(due) + line.graceOf(id));
        line.markLate(id);
        platform.processWindow();

        assertEq(reserve.balanceOf(address(platform)), 0);
        assertEq(reserve.tokenBalance(), 0);
        assertEq(reserve.requiredOf(address(platform)), 6_937_500);
        assertEq(line.requiredReserve(address(platform)), 6_937_500);
        assertEq(line.reserveFloorBps(address(platform)), 750);
        assertEq(line.lateOutstanding(), SHORT);
        assertEq(line.eligibleOutstanding(), 0);
        assertEq(line.exposure(address(platform)), SHORT);
        assertEq(line.outstanding(), 91_510_000);
        assertEq(line.remainingOf(id), SHORT);
        assertEq(line.earnedFees(), 0);
        assertEq(uint256(line.getAdvance(id).status), uint256(ILockgateCreditLine.AdvanceStatus.Late));
        assertEq(line.capital(), lineCash + POSTED);
        assertEq(platform.currentCycleId(), 1);
        assertEq(platform.nextWindow(), due);
        assertEq(platform.getRequest(1).shares, 100e18);
        assertEq(uint256(platform.getRequest(1).status), uint256(IIssuerFund.RequestStatus.Advanced));
        assertEq(platform.shareToken().balanceOf(address(platform)), 200e18);
        assertEq(usdg.balanceOf(investor), 0);
        _queueHeld(platform, SHORT, FACE);
        (, , , string memory why) = line.quote(address(platform), 1e6);
        assertEq(why, "window due");
        assertEq(line.accountedAssets(), line.accountedEquity());
    }

    function test_lateCashRepaysTheLineThenPaysTheQueue() public {
        (WeeklyCyclePlatform platform, uint256 id, uint64 due) = _book();
        uint256 lineCash = line.capital();
        _openWindow(platform, due, id);
        vm.warp(uint256(due) + line.graceOf(id));
        line.markLate(id);

        _mint(stranger, SHORT - 1);
        vm.prank(stranger);
        platform.depositCash(SHORT - 1);
        platform.processWindow();

        assertEq(line.remainingOf(id), 0);
        assertEq(line.lateOutstanding(), 0);
        assertEq(line.exposure(address(platform)), 0);
        assertEq(line.outstanding(), 0);
        assertEq(line.earnedFees(), 990_000);
        assertEq(line.capital(), lineCash + FACE);
        assertEq(line.requiredReserve(address(platform)), 0);
        assertEq(reserve.balanceOf(address(platform)), 0);
        assertEq(line.reserveFloorBps(address(platform)), 750);
        assertEq(uint256(line.getAdvance(id).status), uint256(ILockgateCreditLine.AdvanceStatus.Late));
        assertEq(platform.getRequest(1).shares, 0);
        assertEq(platform.currentCycleId(), 2);
        assertEq(platform.nextWindow(), due + 600);
        assertEq(platform.cash(), 0);
        assertEq(usdg.balanceOf(investor), 0);
        assertEq(uint256(platform.getRequest(2).status), uint256(IIssuerFund.RequestStatus.Queued));
        assertGt(block.timestamp, platform.nextWindow());

        _mint(stranger, FACE);
        vm.prank(stranger);
        platform.depositCash(FACE);
        platform.processWindow();

        assertEq(usdg.balanceOf(investor), FACE);
        assertEq(platform.cash(), 0);
        assertEq(platform.queuedValue(), 0);
        assertEq(platform.currentCycleId(), 3);
        assertEq(platform.nextWindow(), due + 1200);
        assertEq(uint256(platform.getRequest(2).status), uint256(IIssuerFund.RequestStatus.Paid));
        assertEq(platform.shareToken().balanceOf(address(platform)), 0);
        assertEq(reserve.balanceOf(address(platform)), 0);
        assertEq(line.requiredReserve(address(platform)), 0);
        assertEq(line.reserveFloorBps(address(platform)), 750);
        assertEq(line.earnedFees(), 990_000);
        assertEq(line.lateOutstanding(), 0);
        assertEq(uint256(line.getAdvance(id).status), uint256(ILockgateCreditLine.AdvanceStatus.Late));
        (, , , string memory why) = line.quote(address(platform), 1e6);
        assertEq(why, "window due");
        assertEq(line.accountedAssets(), line.accountedEquity());
    }

    function _book() internal returns (WeeklyCyclePlatform platform, uint256 id, uint64 due) {
        platform = new WeeklyCyclePlatform(
            PlatformConfig({
                token: address(usdg),
                creditLine: address(line),
                reserve: address(reserve),
                issuer: issuer,
                name: "Late book",
                nav: 1e6,
                interval: 600,
                initialHolder: issuer,
                initialShares: 200e18
            })
        );
        vm.prank(owner);
        line.registerSource(address(platform), 1_000_000e6, 750);
        _post(address(platform), POSTED);
        vm.prank(issuer);
        platform.setAllowlist(investor, true);
        address share = platform.share();
        vm.prank(issuer);
        IERC20(share).transfer(investor, 100e18);
        vm.prank(issuer);
        (uint256 requestId,) = platform.exitNow(100e18, 0);
        id = platform.getRequest(requestId).advanceId;
        assertEq(requestId, 1);
        assertEq(id, 1);
        assertEq(line.getAdvance(id).fee, 990_000);
        vm.prank(investor);
        assertEq(platform.requestRedeem(100e18), 2);
        due = line.getAdvance(id).dueAt;
        assertEq(due, platform.nextWindow());
        _mint(stranger, 1);
        vm.startPrank(stranger);
        usdg.approve(address(platform), type(uint256).max);
        platform.depositCash(1);
        vm.stopPrank();
    }

    function _openWindow(WeeklyCyclePlatform platform, uint64 due, uint256 id) internal {
        vm.warp(due);
        vm.expectRevert(CreditLineAdmin.TooEarly.selector);
        line.markLate(id);
        platform.processWindow();
    }

    function _queueHeld(WeeklyCyclePlatform platform, uint256 owed, uint256 queued) internal view {
        (uint256 cash, uint256 repayFirst, uint256 payable_, uint256 shortfall) = platform.previewSettlement();
        assertEq(cash, 1);
        assertEq(repayFirst, owed);
        assertEq(payable_, 0);
        assertEq(shortfall, queued);
        assertEq(uint256(platform.getRequest(2).status), uint256(IIssuerFund.RequestStatus.Queued));
    }
}
