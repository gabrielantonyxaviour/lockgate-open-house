// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {CoreFixture, StubSource} from "./Support.sol";
import {OpenCreditVault} from "../../src/core/OpenCreditVault.sol";
import {LockgateExitPool} from "../../src/core/LockgateExitPool.sol";
import {QueueKind} from "../../src/interfaces/IQueueAdapter.sol";
import {WeeklyCyclePlatform} from "../../src/core/WeeklyCyclePlatform.sol";

/// @notice Isolated gas for the stage-1 flows. `forge snapshot --match-contract GasFlowsTest` checks the test totals.
contract GasFlowsTest is CoreFixture {
    function setUp() public {
        _core();
    }

    function test_postReserve() public {
        StubSource stub = _stub(1_000_000e6, 750);
        _mint(issuer, 7_500_000);
        vm.startPrank(issuer);
        usdg.approve(address(reserve), 7_500_000);
        reserve.post(address(stub), 7_500_000);
        _shot("postReserve");
        vm.stopPrank();
    }

    function test_withdrawReserve() public {
        StubSource stub = _stub(1_000_000e6, 750);
        vm.prank(address(stub));
        reserve.setAdmin(address(stub), issuer);
        _post(address(stub), 7_500_000);
        vm.prank(issuer);
        reserve.withdraw(address(stub), 7_500_000);
        _shot("withdrawReserve");
    }

    function test_draw() public {
        StubSource stub = _ready();
        vm.prank(address(stub));
        line.draw(100e6, investor, type(uint256).max);
        _shot("draw");
    }

    function test_repay() public {
        StubSource stub = _ready();
        vm.prank(address(stub));
        (uint256 id,) = line.draw(100e6, investor, type(uint256).max);
        _mint(address(stub), 100e6);
        line.repay(id);
        _shot("repay");
    }

    function test_markLate() public {
        StubSource stub = _ready();
        vm.prank(address(stub));
        (uint256 id,) = line.draw(100e6, investor, type(uint256).max);
        uint64 due = line.getAdvance(id).dueAt;
        uint64 wait = line.graceOf(id);
        vm.warp(uint256(due) + wait);
        line.markLate(id);
        _shot("markLate");
    }

    function test_exitNow() public {
        WeeklyCyclePlatform platform = _week();
        uint256 shares = _fund(platform, 10_000e6);
        vm.prank(investor);
        platform.exitNow(shares, 0);
        _shot("exitNow");
    }

    function test_processWindow() public {
        WeeklyCyclePlatform platform = _week();
        uint256 shares = _fund(platform, 10_000e6);
        vm.prank(investor);
        platform.exitNow(shares, 0);
        uint64 window = platform.nextWindow();
        vm.warp(window);
        platform.processWindow();
        _shot("processWindow");
    }

    function test_sellToLockgate() public {
        (LockgateExitPool pool, uint256 shares) = _door();
        vm.prank(investor);
        pool.sellToLockgate(shares, 0);
        _shot("sellToLockgate");
    }

    function test_settle() public {
        (LockgateExitPool pool, uint256 shares) = _door();
        vm.prank(investor);
        (uint256 id,) = pool.sellToLockgate(shares, 0);
        uint64 ready = pool.getPosition(id).readyAt;
        vm.warp(ready);
        pool.settle(id);
        _shot("settle");
    }

    function _shot(string memory name) internal {
        uint256 used = vm.snapshotGasLastCall("core", name);
        assertGt(used, 20_000);
    }

    function _ready() internal returns (StubSource stub) {
        stub = _stub(1_000_000e6, 750);
        _post(address(stub), 7_500_000);
    }

    function _week() internal returns (WeeklyCyclePlatform platform) {
        vm.prank(issuer);
        platform = WeeklyCyclePlatform(
            factory.createPlatform(QueueKind.WeeklyCycle, "Gas week", 600, 1e6, 1_000_000e6, 750)
        );
        _post(address(platform), 750e6);
    }

    function _fund(WeeklyCyclePlatform platform, uint256 amount) internal returns (uint256 shares) {
        _mint(investor, amount);
        vm.startPrank(investor);
        usdg.approve(address(platform), amount);
        shares = platform.deposit(amount);
        vm.stopPrank();
    }

    function _door() internal returns (LockgateExitPool pool, uint256 shares) {
        OpenCreditVault vault = new OpenCreditVault(owner, address(usdg), true);
        vm.prank(owner);
        usdg.setMinter(address(vault), true);
        pool = new LockgateExitPool(owner, address(vault), address(line));
        vm.prank(owner);
        line.registerSource(address(pool), 1_000_000e6, 0);
        _mint(investor, 100e6);
        vm.startPrank(investor);
        usdg.approve(address(vault), 100e6);
        shares = vault.deposit(100e6);
        IERC20(address(vault)).approve(address(pool), shares);
        vm.stopPrank();
    }
}
