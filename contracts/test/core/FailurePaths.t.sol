// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {CoreFixture, StubSource} from "./Support.sol";
import {QueueKind} from "../../src/interfaces/IQueueAdapter.sol";
import {IIssuerFund} from "../../src/interfaces/IIssuerFund.sol";
import {CreditLineAdmin} from "../../src/core/CreditLineAdmin.sol";
import {PlatformStore} from "../../src/core/PlatformStore.sol";
import {PlatformShare} from "../../src/core/PlatformShare.sol";
import {WeeklyCyclePlatform} from "../../src/core/WeeklyCyclePlatform.sol";
import {EpochQueuePlatform} from "../../src/core/EpochQueuePlatform.sol";
import {QuarterlyWindowPlatform} from "../../src/core/QuarterlyWindowPlatform.sol";
import {FundFactory} from "../../src/core/FundFactory.sol";

/// @notice Boundaries the happy-path suites do not hit: caps, windows, escrow, and factory config.
contract FailurePathsTest is CoreFixture {
    function setUp() public {
        _core();
    }

    function test_feeTooHighUnknownAdvanceAndPausedWithdraw() public {
        StubSource stub = _stub(1_000_000e6, 0);
        vm.expectRevert(abi.encodeWithSelector(CreditLineAdmin.FeeTooHigh.selector, 990_000, 1));
        stub.draw(100e6, investor, 1);
        vm.expectRevert(CreditLineAdmin.UnknownAdvance.selector);
        line.repay(1);
        vm.expectRevert(CreditLineAdmin.UnknownAdvance.selector);
        line.markLate(1);
        vm.prank(owner);
        line.pause();
        vm.prank(owner);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        line.withdrawCapital(1e6);
    }

    function test_zeroUtilizationBlocksAndGraceZeroIsDue() public {
        StubSource stub = _stub(1_000_000e6, 0);
        vm.prank(owner);
        line.setCaps(0, 10_000);
        // A 0 cap rejects any principal. Rounding is up, so the old 1 bp floor no longer lets a draw through.
        vm.expectRevert(CreditLineAdmin.UtilizationCap.selector);
        stub.draw(51_000e6, investor, type(uint256).max);
        vm.prank(owner);
        line.setCaps(10_000, 10_000);
        vm.prank(owner);
        line.setGrace(0);
        (uint256 id,) = stub.draw(1e6, investor, type(uint256).max);
        uint64 due = line.getAdvance(id).dueAt;
        vm.warp(uint256(due) - 1);
        vm.expectRevert(CreditLineAdmin.TooEarly.selector);
        line.markLate(id);
        vm.warp(due);
        line.markLate(id);
        assertEq(line.lateOutstanding(), 1e6);
    }

    function test_secondSourceCannotTakeTheWholeBook() public {
        StubSource first = _stub(1_000_000e6, 0);
        StubSource second = _stub(1_000_000e6, 0);
        first.draw(100e6, investor, type(uint256).max);
        vm.prank(owner);
        line.setCaps(10_000, 5_000);
        second.poke();
        // Exactly 100e6 is 5000 bps. One unit over rounds up and crosses the cap.
        vm.expectRevert(CreditLineAdmin.ConcentrationCap.selector);
        second.draw(100e6 + 1, investor, type(uint256).max);
        second.draw(100e6, investor, type(uint256).max);
        assertLe(line.exposure(address(second)) * 10_000 / line.totalExposure(), 5_000);
    }

    function test_deregisterBlocksUntilRegisteredAgain() public {
        StubSource stub = _stub(1_000_000e6, 0);
        vm.prank(owner);
        line.deregisterSource(address(stub));
        vm.expectRevert(CreditLineAdmin.Unregistered.selector);
        stub.draw(1e6, investor, type(uint256).max);
        vm.prank(owner);
        line.registerSource(address(stub), 1_000_000e6, 0);
        stub.poke();
        stub.draw(1e6, investor, type(uint256).max);
        assertEq(line.exposure(address(stub)), 1e6);
    }

    function test_exitNowRepaysOnTheWindowAndQueuedNavStaysLocked() public {
        WeeklyCyclePlatform platform = _week();
        _mint(investor, 10e6);
        vm.startPrank(investor);
        usdg.approve(address(platform), 10e6);
        platform.deposit(10e6);
        (uint256 id, uint256 payout) = platform.exitNow(10e18, 0);
        vm.stopPrank();
        assertEq(payout, 9_901_000);
        assertEq(uint256(platform.getRequest(id).status), uint256(IIssuerFund.RequestStatus.Advanced));
        vm.expectRevert(PlatformStore.BadStatus.selector);
        vm.prank(investor);
        platform.cancel(id);
        uint64 window = platform.nextWindow();
        vm.expectRevert(PlatformStore.WindowClosed.selector);
        platform.processWindow();
        vm.warp(window);
        platform.processWindow();
        assertEq(line.exposure(address(platform)), 0);
        assertEq(line.earnedFees(), 99_000);
        assertEq(platform.currentCycleId(), 2);
    }

    function test_gateBlocksRedeemNotDepositAndNavDoesNotRewriteTheQueue() public {
        WeeklyCyclePlatform platform = _week();
        _mint(investor, 10e6);
        vm.prank(issuer);
        platform.setGated(true);
        vm.startPrank(investor);
        usdg.approve(address(platform), 10e6);
        uint256 shares = platform.deposit(10e6);
        vm.expectRevert(PlatformStore.Gated.selector);
        platform.requestRedeem(shares);
        vm.stopPrank();
        vm.prank(issuer);
        platform.setGated(false);
        vm.prank(investor);
        uint256 id = platform.requestRedeem(shares);
        assertEq(platform.getRequest(id).navValue, 10e6);
        vm.prank(issuer);
        platform.setNav(2e6);
        assertEq(platform.getRequest(id).navValue, 10e6);
        vm.prank(issuer);
        vm.expectRevert(PlatformStore.ZeroAmount.selector);
        platform.setNav(0);
    }

    function test_epochDustRollsAndQuarterlyUngatePays() public {
        vm.prank(issuer);
        EpochQueuePlatform epoch = EpochQueuePlatform(
            factory.createPlatform(QueueKind.Epoch, "Epoch dust", 600, 1e18, 1_000_000e6, 0)
        );
        _oneUnit(epoch, investor);
        _oneUnit(epoch, issuer);
        vm.prank(issuer);
        epoch.setNav(2e18);
        vm.prank(investor);
        epoch.requestRedeem(1);
        vm.prank(issuer);
        epoch.requestRedeem(1);
        (,, uint256 dustPayable, uint256 dustShort) = epoch.previewSettlement();
        assertEq(dustPayable, 0);
        assertEq(dustShort, 4);
        uint64 window = epoch.nextWindow();
        vm.warp(window);
        epoch.processWindow();
        assertEq(epoch.queuedValue(), 4);
        assertEq(epoch.cash(), 2);
        assertEq(epoch.currentCycleId(), 2);

        vm.prank(issuer);
        QuarterlyWindowPlatform quarter = QuarterlyWindowPlatform(
            factory.createPlatform(QueueKind.QuarterlyGated, "Quarter", 600, 1e6, 1_000_000e6, 0)
        );
        _mint(investor, 5e6);
        vm.startPrank(investor);
        usdg.approve(address(quarter), 5e6);
        quarter.deposit(5e6);
        quarter.requestRedeem(5e18);
        vm.stopPrank();
        vm.prank(issuer);
        quarter.setGated(true);
        vm.warp(quarter.nextWindow());
        vm.expectRevert(PlatformStore.WindowGated.selector);
        quarter.processWindow();
        vm.prank(issuer);
        quarter.setGated(false);
        quarter.processWindow();
        assertEq(uint256(quarter.getRequest(1).status), uint256(IIssuerFund.RequestStatus.Paid));
        assertEq(usdg.balanceOf(investor), 5e6);
    }

    /// @dev Two claims of 3 against cash 5. Each floor payment is 2. The leftover unit stays, and the next epoch still pays 0.
    function test_epochProRataLeavesOneUnitAndBothStayQueued() public {
        vm.prank(issuer);
        EpochQueuePlatform epoch = EpochQueuePlatform(
            factory.createPlatform(QueueKind.Epoch, "Epoch leftover", 600, 1e6, 1_000_000e6, 0)
        );
        _deposit(epoch, investor, 3);
        _deposit(epoch, issuer, 2);
        vm.prank(issuer);
        epoch.setNav(2e6);
        uint256 slice = 3 * 1e18 / 2e6;
        vm.prank(investor);
        uint256 first = epoch.requestRedeem(slice);
        vm.prank(issuer);
        uint256 second = epoch.requestRedeem(slice);
        assertEq(epoch.getRequest(first).navValue, 3);
        assertEq(epoch.getRequest(second).navValue, 3);
        assertEq(epoch.queuedValue(), 6);
        assertEq(epoch.cash(), 5);
        (uint256 cashBalance, uint256 repayFirst, uint256 payable_, uint256 shortfall) = epoch.previewSettlement();
        assertEq(cashBalance, 5);
        assertEq(repayFirst, 0);
        assertEq(payable_, 4);
        assertEq(shortfall, 2);

        uint64 window = epoch.nextWindow();
        vm.warp(window);
        epoch.processWindow();
        assertEq(epoch.cash(), 1);
        assertEq(epoch.queuedValue(), 2);
        assertEq(epoch.queueLength(), 2);
        assertEq(epoch.currentCycleId(), 2);
        assertEq(usdg.balanceOf(investor), 2);
        assertEq(usdg.balanceOf(issuer), 2);
        assertEq(uint256(epoch.getRequest(first).status), uint256(IIssuerFund.RequestStatus.Queued));
        assertEq(uint256(epoch.getRequest(second).status), uint256(IIssuerFund.RequestStatus.Queued));
        assertEq(epoch.getRequest(first).navValue, 1);
        assertEq(epoch.getRequest(second).navValue, 1);
        assertEq(epoch.getRequest(first).shares, 5e11);
        assertEq(epoch.getRequest(second).shares, 5e11);

        uint64 later = epoch.nextWindow();
        vm.warp(later);
        epoch.processWindow();
        assertEq(epoch.cash(), 1);
        assertEq(epoch.queuedValue(), 2);
        assertEq(epoch.currentCycleId(), 3);
        assertEq(usdg.balanceOf(investor), 2);
        assertEq(usdg.balanceOf(issuer), 2);
        assertEq(epoch.getRequest(first).navValue, 1);
        assertEq(epoch.getRequest(second).navValue, 1);
    }

    function test_shareNeedsAllowlistAndFactoryRejectsBadConfig() public {
        WeeklyCyclePlatform platform = _week();
        _mint(issuer, 2e6);
        vm.startPrank(issuer);
        usdg.approve(address(platform), 2e6);
        platform.deposit(2e6);
        IERC20 share = IERC20(platform.share());
        vm.expectRevert(PlatformShare.NotAllowlisted.selector);
        share.transfer(investor, 1e18);
        platform.setAllowlist(investor, true);
        share.transfer(investor, 1e18);
        vm.stopPrank();
        assertEq(share.balanceOf(investor), 1e18);

        vm.prank(issuer);
        vm.expectRevert(FundFactory.BadKind.selector);
        factory.createPlatform(QueueKind.None, "nope", 600, 1e6, 1, 0);
        vm.prank(owner);
        vm.expectRevert(FundFactory.BadParam.selector);
        factory.setDemoWindow(0);
    }

    function _week() internal returns (WeeklyCyclePlatform platform) {
        vm.prank(issuer);
        platform = WeeklyCyclePlatform(
            factory.createPlatform(QueueKind.WeeklyCycle, "Week", 600, 1e6, 1_000_000e6, 750)
        );
        _post(address(platform), 20e6);
    }

    function _oneUnit(EpochQueuePlatform epoch, address account) internal {
        _mint(account, 1);
        vm.startPrank(account);
        usdg.approve(address(epoch), 1);
        epoch.deposit(1);
        vm.stopPrank();
    }

    function _deposit(EpochQueuePlatform epoch, address account, uint256 amount) internal {
        _mint(account, amount);
        vm.startPrank(account);
        usdg.approve(address(epoch), amount);
        epoch.deposit(amount);
        vm.stopPrank();
    }
}
