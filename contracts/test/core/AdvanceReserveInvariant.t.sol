// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Vm} from "forge-std/Vm.sol";
import {StdInvariant} from "forge-std/StdInvariant.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {CoreFixture, StubSource} from "./Support.sol";
import {ILockgateCreditLine} from "../../src/interfaces/ILockgateCreditLine.sol";
import {LockgateCreditLine} from "../../src/core/LockgateCreditLine.sol";
import {PlatformReserve} from "../../src/core/PlatformReserve.sol";
import {MockUSDG} from "../../src/core/MockUSDG.sol";

/// @notice Fuzzes two sources. Refused calls are caught. The invariant rebuilds the book from advances.
contract AdvanceHandler {
    Vm private constant VM = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    LockgateCreditLine public immutable line;
    PlatformReserve public immutable reserve;
    MockUSDG public immutable usdg;
    StubSource public immutable first;
    StubSource public immutable second;
    address public immutable owner;
    address public immutable issuer;

    constructor(
        address line_,
        address reserve_,
        address usdg_,
        address first_,
        address second_,
        address owner_,
        address issuer_
    ) {
        line = LockgateCreditLine(line_);
        reserve = PlatformReserve(reserve_);
        usdg = MockUSDG(usdg_);
        first = StubSource(first_);
        second = StubSource(second_);
        owner = owner_;
        issuer = issuer_;
    }

    function draw(uint8 which, uint96 amount) external {
        if (line.advanceCount() >= 16) return;
        if (amount < 1e6) return;
        uint256 nav = amount > 20_000e6 ? 20_000e6 : amount;
        StubSource stub = _source(which);
        stub.poke();
        _cover(address(stub), line.exposure(address(stub)) + nav);
        try stub.draw(nav, issuer, type(uint256).max) {} catch {}
    }

    function repay(uint256 salt) external {
        uint256 count = line.advanceCount();
        if (count == 0) return;
        uint256 id = (salt % count) + 1;
        uint256 remaining = line.remainingOf(id);
        if (remaining == 0) return;
        address source = line.getAdvance(id).source;
        if (usdg.balanceOf(source) < remaining) usdg.mint(source, remaining - usdg.balanceOf(source));
        try line.repay(id) {} catch {}
    }

    function markLate(uint256 salt) external {
        uint256 count = line.advanceCount();
        if (count == 0) return;
        uint256 id = (salt % count) + 1;
        if (line.remainingOf(id) == 0) return;
        uint64 due = line.getAdvance(id).dueAt;
        if (block.timestamp < uint256(due) + line.graceOf(id)) return;
        try line.markLate(id) {} catch {}
    }

    function post(uint8 which, uint96 amount) external {
        if (amount == 0) return;
        _sendReserve(address(_source(which)), amount);
    }

    function withdraw(uint8 which, uint96 amount) external {
        if (amount == 0) return;
        try reserve.withdraw(address(_source(which)), amount) {} catch {}
    }

    function retarget(uint8 which, uint16 bps) external {
        uint16 next = bps > 10_000 ? 10_000 : bps;
        VM.prank(owner);
        try line.setSourceTerms(address(_source(which)), 1_000_000e6, next, 0) {} catch {}
    }

    function warp(uint32 step) external {
        if (step == 0 || step > 2 days) return;
        VM.warp(block.timestamp + step);
    }

    function _source(uint8 which) internal view returns (StubSource) {
        return which % 2 == 0 ? first : second;
    }

    function _cover(address source, uint256 exposure) internal {
        uint16 live = line.reserveBpsOf(source);
        uint16 floor = line.reserveFloorBps(source);
        uint16 bps = live > floor ? live : floor;
        if (bps == 0 || exposure == 0) return;
        uint256 need = Math.mulDiv(exposure, bps, 10_000, Math.Rounding.Ceil);
        uint256 have = reserve.balanceOf(source);
        if (have >= need) return;
        _sendReserve(source, need - have);
    }

    function _sendReserve(address source, uint256 amount) internal {
        usdg.mint(address(this), amount);
        usdg.approve(address(reserve), amount);
        reserve.post(source, amount);
    }
}

contract AdvanceReserveInvariantTest is StdInvariant, CoreFixture {
    AdvanceHandler internal handler;

    function setUp() public {
        _core();
        StubSource first = _stub(1_000_000e6, 750);
        StubSource second = _stub(1_000_000e6, 500);
        handler = new AdvanceHandler(
            address(line), address(reserve), address(usdg), address(first), address(second), owner, issuer
        );
        vm.prank(address(first));
        reserve.setAdmin(address(first), address(handler));
        vm.prank(address(second));
        reserve.setAdmin(address(second), address(handler));
        vm.prank(owner);
        usdg.setMinter(address(handler), true);
        targetContract(address(handler));
        bytes4[] memory selectors = new bytes4[](7);
        selectors[0] = handler.draw.selector;
        selectors[1] = handler.repay.selector;
        selectors[2] = handler.markLate.selector;
        selectors[3] = handler.post.selector;
        selectors[4] = handler.withdraw.selector;
        selectors[5] = handler.retarget.selector;
        selectors[6] = handler.warp.selector;
        targetSelector(FuzzSelector({addr: address(handler), selectors: selectors}));
    }

    /// forge-config: default.invariant.runs = 64
    /// forge-config: default.invariant.depth = 40
    function invariant_reserveMatchesAdvances() public view {
        address[] memory sources = line.sources();
        uint256 listed;
        uint256 reserveSum;
        for (uint256 i; i < sources.length; ++i) {
            address source = sources[i];
            uint256 exposure = line.exposure(source);
            uint16 live = line.reserveBpsOf(source);
            uint16 floor = line.reserveFloorBps(source);
            if (exposure == 0) assertEq(floor, live);
            uint16 active = live > floor ? live : floor;
            uint256 required =
                exposure == 0 || active == 0 ? 0 : Math.mulDiv(exposure, active, 10_000, Math.Rounding.Ceil);
            assertEq(line.requiredReserve(source), required);
            reserveSum += reserve.balanceOf(source);
            listed += exposure;
        }
        assertEq(listed, line.totalExposure());
        assertEq(reserveSum, reserve.totalBalances());
        assertEq(reserve.tokenBalance(), reserve.totalBalances());

        uint256 n = line.advanceCount();
        uint256 exposureLeft;
        uint256 unpaidPrincipal;
        uint256 fees;
        uint256 eligible;
        uint256 late;
        for (uint256 id = 1; id <= n; ++id) {
            ILockgateCreditLine.Advance memory advance = line.getAdvance(id);
            uint256 nav = advance.principal + advance.fee;
            uint256 recovered = line.recoveredOf(id);
            assertLe(recovered, nav);
            uint256 remaining = nav - recovered;
            exposureLeft += remaining;
            if (recovered < advance.principal) unpaidPrincipal += advance.principal - recovered;
            if (recovered > advance.principal) fees += recovered - advance.principal;
            if (advance.status == ILockgateCreditLine.AdvanceStatus.Active) {
                assertGt(remaining, 0);
                eligible += remaining;
            } else if (advance.status == ILockgateCreditLine.AdvanceStatus.Repaid) {
                assertEq(remaining, 0);
            } else {
                assertEq(uint8(advance.status), uint8(ILockgateCreditLine.AdvanceStatus.Late));
                late += remaining;
            }
        }
        assertEq(exposureLeft, line.totalExposure());
        assertEq(unpaidPrincipal, line.outstanding());
        assertEq(fees, line.earnedFees());
        assertEq(eligible, line.eligibleOutstanding());
        assertEq(late, line.lateOutstanding());
        assertEq(line.accountedAssets(), line.accountedEquity());
    }

    function test_loweredRateKeepsTheOpenFloor() public {
        handler.draw(0, 100e6);
        assertEq(line.requiredReserve(address(handler.first())), 7_500_000);
        handler.retarget(0, 0);
        assertEq(line.reserveBpsOf(address(handler.first())), 0);
        assertEq(line.reserveFloorBps(address(handler.first())), 750);
        invariant_reserveMatchesAdvances();
        handler.repay(1);
        assertEq(line.reserveFloorBps(address(handler.first())), 0);
        invariant_reserveMatchesAdvances();
    }
}
