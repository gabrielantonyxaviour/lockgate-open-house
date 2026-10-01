// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test, Vm} from "forge-std/Test.sol";
import {StdInvariant} from "forge-std/StdInvariant.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {MockUSDG} from "../../src/core/MockUSDG.sol";
import {UsdgAdapter} from "../../src/core/UsdgAdapter.sol";
import {PricingEngine} from "../../src/core/PricingEngine.sol";
import {PlatformReserve} from "../../src/core/PlatformReserve.sol";
import {LockgateCreditLine} from "../../src/core/LockgateCreditLine.sol";
import {StubSource} from "./Support.sol";

contract BookHandler {
    Vm private constant VM = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    LockgateCreditLine public immutable line;
    PlatformReserve public immutable reserve;
    MockUSDG public immutable usdg;
    StubSource public immutable stub;
    address public immutable owner;

    constructor(address line_, address reserve_, address usdg_, address stub_, address owner_) {
        line = LockgateCreditLine(line_);
        reserve = PlatformReserve(reserve_);
        usdg = MockUSDG(usdg_);
        stub = StubSource(stub_);
        owner = owner_;
    }

    function deposit(uint96 amount) external {
        if (amount < 1e6 || amount > 20_000e6) return;
        usdg.mint(owner, amount);
        VM.startPrank(owner);
        usdg.approve(address(line), amount);
        line.depositCapital(amount);
        VM.stopPrank();
    }

    function draw(uint96 amount) external {
        if (amount < 1e6) return;
        uint256 nav = amount > 25_000e6 ? 25_000e6 : amount;
        uint256 need = (line.exposure(address(stub)) + nav) * 750 / 10_000 + 1;
        uint256 have = reserve.balanceOf(address(stub));
        if (have < need) _top(need - have);
        stub.poke();
        try stub.draw(nav, owner, type(uint256).max) {} catch {}
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
        if (block.timestamp < uint256(due) + line.grace()) return;
        try line.markLate(id) {} catch {}
    }

    function warp(uint32 step) external {
        if (step == 0 || step > 2 days) return;
        VM.warp(block.timestamp + step);
    }

    function _top(uint256 amount) internal {
        usdg.mint(owner, amount);
        VM.startPrank(owner);
        usdg.approve(address(reserve), amount);
        reserve.post(address(stub), amount);
        VM.stopPrank();
    }
}

contract SolvencyTest is StdInvariant, Test {
    LockgateCreditLine internal line;
    PlatformReserve internal reserve;
    MockUSDG internal usdg;
    BookHandler internal handler;

    function setUp() public {
        address owner = makeAddr("owner");
        usdg = new MockUSDG(owner);
        UsdgAdapter adapter = new UsdgAdapter(address(usdg), true);
        PricingEngine pricing = new PricingEngine(owner);
        reserve = new PlatformReserve(owner, address(adapter));
        line = new LockgateCreditLine(owner, address(adapter), address(pricing), address(reserve));
        vm.startPrank(owner);
        reserve.setCreditLine(address(line));
        reserve.setSlasher(address(line), true);
        usdg.mint(owner, 200_000e6);
        usdg.approve(address(line), type(uint256).max);
        line.depositCapital(100_000e6);
        vm.stopPrank();
        StubSource stub = new StubSource(address(line));
        vm.prank(owner);
        line.registerSource(address(stub), 1_000_000e6, 750);
        handler = new BookHandler(address(line), address(reserve), address(usdg), address(stub), owner);
        vm.prank(owner);
        usdg.setMinter(address(handler), true);
        excludeContract(address(this));
        targetContract(address(handler));
        bytes4[] memory selectors = new bytes4[](5);
        selectors[0] = handler.deposit.selector;
        selectors[1] = handler.draw.selector;
        selectors[2] = handler.repay.selector;
        selectors[3] = handler.markLate.selector;
        selectors[4] = handler.warp.selector;
        targetSelector(FuzzSelector({addr: address(handler), selectors: selectors}));
    }

    function invariant_bookAndReserveBalance() public view {
        assertEq(line.accountedAssets(), line.accountedEquity());
        assertEq(reserve.tokenBalance(), reserve.totalBalances());
        assertGe(line.accountedAssets(), line.outstanding());
        assertEq(line.eligibleOutstanding() + line.lateOutstanding(), line.totalExposure());
    }

    function test_walkDrawWithdrawRepayAndSlash() public {
        _walk(StubSource(handler.stub()));
    }

    function _walk(StubSource stub) internal {
        address owner = handler.owner();
        vm.startPrank(owner);
        usdg.mint(owner, 8e6);
        usdg.approve(address(reserve), 8e6);
        reserve.post(address(stub), 8e6);
        vm.stopPrank();
        (uint256 id, uint256 fee) = stub.draw(100e6, owner, type(uint256).max);
        assertEq(fee, 990_000);
        assertEq(line.eligibleOutstanding(), 100e6);
        assertEq(line.lateOutstanding(), 0);
        assertEq(line.accountedAssets(), line.accountedEquity());
        uint256 idle = line.accountedEquity() - line.outstanding();
        vm.prank(owner);
        line.withdrawCapital(idle);
        assertEq(line.accountedAssets(), line.accountedEquity());
        vm.warp(stub.nextWindow() + line.grace());
        line.markLate(id);
        assertEq(line.eligibleOutstanding(), 0);
        assertEq(line.lateOutstanding(), 92e6);
        assertEq(line.accountedAssets(), line.accountedEquity());
        uint256 rest = line.remainingOf(id);
        vm.prank(owner);
        usdg.mint(address(stub), rest);
        line.repay(id);
        assertEq(line.earnedFees(), 990_000);
        assertEq(line.remainingOf(id), 0);
        assertEq(line.eligibleOutstanding(), 0);
        assertEq(line.lateOutstanding(), 0);
        assertEq(line.accountedAssets(), line.accountedEquity());
        assertEq(usdg.balanceOf(address(line)) + line.outstanding(), line.accountedEquity());
    }
}
