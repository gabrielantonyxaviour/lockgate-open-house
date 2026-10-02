// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {CoreFixture, StubSource} from "./Support.sol";
import {QueueKind} from "../../src/interfaces/IQueueAdapter.sol";
import {ILockgateCreditLine} from "../../src/interfaces/ILockgateCreditLine.sol";
import {WeeklyCyclePlatform} from "../../src/core/WeeklyCyclePlatform.sol";

/// @notice Pins three stage-1 holes. A 5–10% reserve and a late-book stop are not enforced here.
contract OpenHolesTest is CoreFixture {
    function setUp() public {
        _core();
    }

    function test_strangerZeroReserveDrawPaysFromTheLine() public {
        vm.prank(stranger);
        WeeklyCyclePlatform fund = WeeklyCyclePlatform(
            factory.createPlatform(QueueKind.WeeklyCycle, "Zero reserve", 600, 1e6, 5_000e6, 0)
        );
        assertEq(fund.issuer(), stranger);
        assertEq(line.reserveBpsOf(address(fund)), 0);
        assertEq(reserve.balanceOf(address(fund)), 0);
        assertEq(usdg.balanceOf(address(fund)), 0);
        (uint256 fee, uint16 bps, bool available, string memory reason) = line.quote(address(fund), 100e6);
        assertTrue(available, reason);
        assertEq(bps, 99);
        assertEq(fee, 990_000);

        vm.prank(issuer);
        address band = factory.createPlatform(QueueKind.WeeklyCycle, "Band", 600, 1e6, 5_000e6, 750);
        (,,, string memory blocked) = line.quote(band, 100e6);
        assertEq(blocked, "reserve");
        assertEq(usdg.balanceOf(band), 0);
        assertEq(reserve.balanceOf(band), 0);

        _mint(stranger, 100e6);
        vm.startPrank(stranger);
        usdg.approve(address(fund), 100e6);
        fund.deposit(100e6);
        uint256 shares = IERC20(fund.share()).balanceOf(stranger);
        uint256 cash = usdg.balanceOf(address(fund));
        uint256 lineBefore = usdg.balanceOf(address(line));
        uint256 holderBefore = usdg.balanceOf(stranger);
        (, uint256 payout) = fund.exitNow(shares, 0);
        vm.stopPrank();

        assertEq(payout, 100e6 - fee);
        assertEq(usdg.balanceOf(stranger), holderBefore + payout);
        assertEq(usdg.balanceOf(address(line)), lineBefore - payout);
        assertEq(usdg.balanceOf(address(fund)), cash);
        assertEq(reserve.balanceOf(address(fund)), 0);
        assertEq(line.requiredReserve(address(fund)), 0);
        assertEq(line.exposure(address(fund)), 100e6);
        assertEq(line.lateOutstanding(), 0);
    }

    function test_setNavAboveCashStillDrawsTheLine() public {
        vm.prank(stranger);
        WeeklyCyclePlatform fund = WeeklyCyclePlatform(
            factory.createPlatform(QueueKind.WeeklyCycle, "Marked cash", 600, 1e6, 5_000e6, 750)
        );
        (,,, string memory blocked) = line.quote(address(fund), 10e6);
        assertEq(blocked, "reserve");
        _post(address(fund), 750_000);
        _mint(stranger, 1e6);
        vm.startPrank(stranger);
        usdg.approve(address(fund), 1e6);
        fund.deposit(1e6);
        fund.setNav(10e6);
        uint256 shares = IERC20(fund.share()).balanceOf(stranger);
        uint256 cash = usdg.balanceOf(address(fund));
        (uint256 fee,, bool available, string memory reason) = line.quote(address(fund), 10e6);
        assertTrue(available, reason);
        assertEq(fee, 99_000);
        uint256 lineBefore = usdg.balanceOf(address(line));
        (, uint256 payout) = fund.exitNow(shares, 0);
        vm.stopPrank();

        assertEq(cash, 1e6);
        assertGt(payout, cash);
        assertEq(payout, 10e6 - fee);
        assertEq(usdg.balanceOf(address(fund)), cash);
        assertEq(usdg.balanceOf(address(line)), lineBefore - payout);
        assertEq(line.exposure(address(fund)), 10e6);
    }

    function test_lateBookDoesNotBlockTheNextDraw() public {
        StubSource stub = _stub(1_000_000e6, 750);
        _post(address(stub), 7_500_000);
        (uint256 first,) = stub.draw(100e6, investor, type(uint256).max);
        ILockgateCreditLine.Advance memory opened = line.getAdvance(first);
        vm.warp(uint256(opened.dueAt) + line.grace());
        line.markLate(first);
        assertEq(uint256(line.getAdvance(first).status), uint256(ILockgateCreditLine.AdvanceStatus.Late));
        assertEq(line.lateOutstanding(), 92_500_000);
        assertEq(line.eligibleOutstanding(), 0);
        assertEq(reserve.balanceOf(address(stub)), 0);
        stub.poke();
        (,,, string memory why) = line.quote(address(stub), 100e6);
        assertEq(why, "reserve");
        uint256 need = Math.mulDiv(line.exposure(address(stub)) + 100e6, 750, 10_000, Math.Rounding.Ceil);
        _post(address(stub), need);
        (uint256 second,) = stub.draw(100e6, investor, type(uint256).max);
        assertEq(uint256(line.getAdvance(first).status), uint256(ILockgateCreditLine.AdvanceStatus.Late));
        assertEq(uint256(line.getAdvance(second).status), uint256(ILockgateCreditLine.AdvanceStatus.Active));
        assertEq(line.lateOutstanding(), 92_500_000);
        assertEq(line.eligibleOutstanding(), 100e6);
        assertEq(line.exposure(address(stub)), line.lateOutstanding() + 100e6);
    }
}
