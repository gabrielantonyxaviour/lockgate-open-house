// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test, Vm} from "forge-std/Test.sol";
import {StdInvariant} from "forge-std/StdInvariant.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {CoreFixture} from "./Support.sol";
import {QueueKind} from "../../src/interfaces/IQueueAdapter.sol";
import {IIssuerFund} from "../../src/interfaces/IIssuerFund.sol";
import {WeeklyCyclePlatform} from "../../src/core/WeeklyCyclePlatform.sol";
import {LockgateCreditLine} from "../../src/core/LockgateCreditLine.sol";
import {MockUSDG} from "../../src/core/MockUSDG.sol";

contract QueueHandler {
    Vm private constant VM = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    WeeklyCyclePlatform public immutable platform;
    LockgateCreditLine public immutable line;
    MockUSDG public immutable usdg;
    address public immutable actor;

    constructor(address platform_, address line_, address usdg_, address actor_) {
        platform = WeeklyCyclePlatform(platform_);
        line = LockgateCreditLine(line_);
        usdg = MockUSDG(usdg_);
        actor = actor_;
    }

    function deposit(uint96 amount) external {
        if (amount < 1e6 || amount > 5_000e6) return;
        usdg.mint(actor, amount);
        VM.startPrank(actor);
        usdg.approve(address(platform), amount);
        platform.deposit(amount);
        VM.stopPrank();
    }

    function queue(uint256 salt) external {
        uint256 shares = IERC20(platform.share()).balanceOf(actor);
        if (shares == 0) return;
        uint256 sell = shares / 2;
        if (sell == 0 || salt % 2 == 0) sell = shares;
        VM.prank(actor);
        try platform.requestRedeem(sell) {} catch {}
    }

    function cancel(uint256 salt) external {
        uint256 count = platform.requestCount();
        if (count == 0) return;
        uint256 id = (salt % count) + 1;
        if (platform.getRequest(id).owner != actor) return;
        VM.prank(actor);
        try platform.cancel(id) {} catch {}
    }

    function exitEarly(uint256 salt) external {
        uint256 count = platform.requestCount();
        if (count == 0) return;
        uint256 id = (salt % count) + 1;
        if (platform.getRequest(id).owner != actor) return;
        VM.prank(actor);
        try platform.exitEarly(id, 0) {} catch {}
    }

    function warp(uint32 step) external {
        if (step == 0 || step > 1 days) return;
        VM.warp(block.timestamp + step);
    }

    function settle() external {
        try platform.processWindow() {} catch {}
    }
}

contract QueueInvariantTest is StdInvariant, CoreFixture {
    QueueHandler internal handler;
    WeeklyCyclePlatform internal platform;

    function setUp() public {
        _core();
        address actor = makeAddr("queue-actor");
        vm.prank(issuer);
        platform = WeeklyCyclePlatform(
            factory.createPlatform(QueueKind.WeeklyCycle, "Invariant book", 600, 1e6, 1_000_000e6, 750)
        );
        _post(address(platform), 100_000e6);
        handler = new QueueHandler(address(platform), address(line), address(usdg), actor);
        vm.prank(owner);
        usdg.setMinter(address(handler), true);
        targetContract(address(handler));
        bytes4[] memory selectors = new bytes4[](6);
        selectors[0] = handler.deposit.selector;
        selectors[1] = handler.queue.selector;
        selectors[2] = handler.cancel.selector;
        selectors[3] = handler.exitEarly.selector;
        selectors[4] = handler.warp.selector;
        selectors[5] = handler.settle.selector;
        targetSelector(FuzzSelector({addr: address(handler), selectors: selectors}));
    }

    function invariant_queueEscrowAndBook() public view {
        uint256 queued;
        uint256 value;
        uint256 escrow;
        uint256 count = platform.requestCount();
        for (uint256 id = 1; id <= count; ++id) {
            IIssuerFund.Request memory request = platform.getRequest(id);
            if (request.status == IIssuerFund.RequestStatus.Queued) {
                queued += 1;
                value += request.navValue;
                escrow += request.shares;
            } else if (request.status == IIssuerFund.RequestStatus.Advanced && request.shares != 0) {
                escrow += request.shares;
            }
        }
        assertEq(platform.queueLength(), queued);
        assertEq(platform.queuedValue(), value);
        assertEq(IERC20(platform.share()).balanceOf(address(platform)), escrow);
        assertEq(line.accountedAssets(), line.accountedEquity());
        assertEq(line.eligibleOutstanding() + line.lateOutstanding(), line.totalExposure());
    }
}
