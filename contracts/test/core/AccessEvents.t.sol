// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {Vm} from "forge-std/Vm.sol";
import {CoreFixture, StubSource} from "./Support.sol";
import {ILockgateCreditLine} from "../../src/interfaces/ILockgateCreditLine.sol";
import {IPricingEngine} from "../../src/interfaces/IPricingEngine.sol";
import {IIssuerFund} from "../../src/interfaces/IIssuerFund.sol";
import {QueueKind} from "../../src/interfaces/IQueueAdapter.sol";
import {CreditLineAdmin} from "../../src/core/CreditLineAdmin.sol";
import {PlatformReserve} from "../../src/core/PlatformReserve.sol";
import {PlatformStore} from "../../src/core/PlatformStore.sol";
import {PlatformShare} from "../../src/core/PlatformShare.sol";
import {FundFactory} from "../../src/core/FundFactory.sol";
import {PricingEngine} from "../../src/core/PricingEngine.sol";
import {MockUSDG} from "../../src/core/MockUSDG.sol";
import {OpenCreditVault} from "../../src/core/OpenCreditVault.sol";
import {LockgateExitPool} from "../../src/core/LockgateExitPool.sol";
import {WeeklyCyclePlatform} from "../../src/core/WeeklyCyclePlatform.sol";

/// @notice Access checks and the events those calls emit. Epoch and quarterly share the weekly deposit path.
contract AccessEventsTest is CoreFixture {
    function setUp() public {
        _core();
    }

    function test_ownerUpdateDoesNotEmitASecondRegistration() public {
        StubSource stub = _stub(1_000_000e6, 750);
        vm.expectEmit(true, false, false, true, address(line));
        emit ILockgateCreditLine.SourceUpdated(address(stub), 3_000_000e6, 750, 0);
        vm.prank(owner);
        line.registerSource(address(stub), 3_000_000e6, 750);
        assertEq(line.limitOf(address(stub)), 3_000_000e6);
        assertEq(line.reserveBpsOf(address(stub)), 750);
    }

    function test_registrarCannotRestoreADeregisteredSource() public {
        StubSource stub = _stub(1_000_000e6, 750);
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger));
        line.deregisterSource(address(stub));
        vm.prank(owner);
        line.deregisterSource(address(stub));
        assertFalse(line.registered(address(stub)));
        assertEq(line.limitOf(address(stub)), 1_000_000e6);
        vm.prank(address(factory));
        vm.expectRevert(CreditLineAdmin.AlreadyRegistered.selector);
        line.registerSource(address(stub), 1, 0);
        assertFalse(line.registered(address(stub)));

        vm.expectEmit(true, false, false, true, address(line));
        emit ILockgateCreditLine.SourceRegistered(address(stub), 2_000_000e6, 750);
        vm.expectEmit(true, false, false, true, address(line));
        emit ILockgateCreditLine.SourceUpdated(address(stub), 2_000_000e6, 750, 0);
        vm.prank(owner);
        line.registerSource(address(stub), 2_000_000e6, 750);
        assertTrue(line.registered(address(stub)));
        assertEq(line.sources().length, 1);
    }

    function test_postReserveNamesThePayer() public {
        StubSource stub = _stub(1e6, 0);
        _mint(stranger, 1e6);
        vm.prank(stranger);
        usdg.approve(address(line), 1e6);
        vm.expectEmit(true, true, false, true, address(reserve));
        emit PlatformReserve.Posted(address(stub), address(line), 1e6);
        vm.expectEmit(true, true, false, true, address(line));
        emit ILockgateCreditLine.ReservePosted(address(stub), stranger, 1e6);
        vm.prank(stranger);
        line.postReserve(address(stub), 1e6);
        assertEq(reserve.balanceOf(address(stub)), 1e6);
        assertEq(usdg.balanceOf(address(line)), 500_000e6);
    }

    function test_drawAndRepayEmitTheBook() public {
        StubSource stub = _stub(1_000_000e6, 750);
        _post(address(stub), 20e6);
        uint64 due = uint64(block.timestamp) + 600;
        vm.expectEmit(true, true, true, true, address(line));
        emit ILockgateCreditLine.AdvanceDrawn(1, address(stub), investor, 99_010_000, 990_000, due);
        (uint256 id,) = stub.draw(100e6, investor, type(uint256).max);
        _mint(address(stub), 100e6);
        vm.expectEmit(true, true, false, true, address(line));
        emit ILockgateCreditLine.AdvanceRepaid(id, address(stub), 100e6, ILockgateCreditLine.AdvanceStatus.Repaid);
        line.repay(id);
        assertEq(line.earnedFees(), 990_000);
    }

    function test_markLateEmitsTheSlash() public {
        StubSource stub = _stub(1_000_000e6, 750);
        _post(address(stub), 20e6);
        (uint256 id,) = stub.draw(100e6, investor, type(uint256).max);
        uint64 due = line.getAdvance(id).dueAt;
        vm.warp(uint256(due) + line.graceOf(id));
        vm.expectEmit(true, true, false, true, address(reserve));
        emit PlatformReserve.Slashed(address(stub), address(line), 20e6);
        vm.expectEmit(true, true, false, true, address(line));
        emit ILockgateCreditLine.AdvanceMarkedLate(id, address(stub), 20e6, 80e6);
        line.markLate(id);
        assertEq(line.lateOutstanding(), 80e6);
    }

    function test_strangerCannotCallOwnerControls() public {
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger));
        line.setGrace(2 days);
        vm.expectEmit(false, false, false, true, address(line));
        emit ILockgateCreditLine.GraceSet(2 days);
        vm.prank(owner);
        line.setGrace(2 days);

        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger));
        line.setCaps(1_000, 1_000);
        vm.expectEmit(false, false, false, true, address(line));
        emit ILockgateCreditLine.CapsSet(1_000, 1_000);
        vm.prank(owner);
        line.setCaps(1_000, 1_000);

        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger));
        line.depositCapital(1);
        vm.expectEmit(true, false, false, true, address(line));
        emit ILockgateCreditLine.CapitalDeposited(owner, 1);
        vm.prank(owner);
        line.depositCapital(1);

        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger));
        line.withdrawCapital(1);
        vm.expectEmit(true, false, false, true, address(line));
        emit ILockgateCreditLine.CapitalWithdrawn(owner, 1);
        vm.prank(owner);
        line.withdrawCapital(1);

        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger));
        line.pause();
        vm.expectEmit(true, false, false, true, address(line));
        emit Pausable.Paused(owner);
        vm.prank(owner);
        line.pause();
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger));
        line.unpause();
        vm.expectEmit(true, false, false, true, address(line));
        emit Pausable.Unpaused(owner);
        vm.prank(owner);
        line.unpause();
        assertFalse(line.paused());

        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger));
        factory.setDemoWindow(120);
        vm.expectEmit(false, false, false, true, address(factory));
        emit FundFactory.DemoWindowSet(120);
        vm.prank(owner);
        factory.setDemoWindow(120);
        assertEq(factory.demoWindow(), 120);

        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger));
        usdg.setMinter(stranger, true);
        vm.expectEmit(true, false, false, true, address(usdg));
        emit MockUSDG.MinterSet(stranger, true);
        vm.prank(owner);
        usdg.setMinter(stranger, true);

        IPricingEngine.Params memory p = pricing.params();
        p.minFeeBps = 26;
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger));
        pricing.setParams(p);
        vm.expectEmit(false, false, false, true, address(pricing));
        emit PricingEngine.ParamsUpdated(p);
        vm.prank(owner);
        pricing.setParams(p);

        OpenCreditVault vault = new OpenCreditVault(owner, address(usdg), false);
        LockgateExitPool pool = new LockgateExitPool(owner, address(vault), address(line));
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger));
        vault.setCooldown(1 hours);
        vm.expectEmit(false, false, false, true, address(vault));
        emit OpenCreditVault.CooldownSet(1 hours);
        vm.prank(owner);
        vault.setCooldown(1 hours);
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger));
        pool.setGated(true);
        vm.expectEmit(false, false, false, true, address(pool));
        emit LockgateExitPool.GatedSet(true);
        vm.prank(owner);
        pool.setGated(true);
        assertTrue(pool.gated());

        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger));
        reserve.lockSlasherSet();
        vm.expectEmit(false, false, false, true, address(reserve));
        emit PlatformReserve.SlashersLockedSet();
        vm.prank(owner);
        reserve.lockSlasherSet();
        vm.prank(owner);
        vm.expectRevert(PlatformReserve.SlashersLocked.selector);
        reserve.lockSlasherSet();
        assertTrue(reserve.slashersLocked());
    }

    function test_initializeEmitsConfigured() public {
        vm.recordLogs();
        vm.prank(owner);
        WeeklyCyclePlatform platform =
            WeeklyCyclePlatform(factory.createPlatform(QueueKind.WeeklyCycle, "Week", 600, 1e6, issuer, 1, 0));
        Vm.Log[] memory logs = vm.getRecordedLogs();
        bytes32 topic = PlatformStore.Configured.selector;
        bool found;
        for (uint256 i; i < logs.length; i++) {
            if (logs[i].topics[0] != topic) continue;
            found = true;
            assertEq(logs[i].emitter, address(platform));
            assertEq(address(uint160(uint256(logs[i].topics[1]))), issuer);
            (uint256 nav, uint64 interval) = abi.decode(logs[i].data, (uint256, uint64));
            assertEq(nav, 1e6);
            assertEq(interval, 600);
        }
        assertTrue(found);
        assertEq(platform.issuer(), issuer);
    }

    function test_issuerBanBlocksDepositAndStillLetsTheHolderQueue() public {
        vm.prank(owner);
        WeeklyCyclePlatform platform =
            WeeklyCyclePlatform(factory.createPlatform(QueueKind.WeeklyCycle, "Ban", 600, 1e6, issuer, 1, 0));
        address share = platform.share();
        _mint(issuer, 1e6);
        vm.startPrank(issuer);
        usdg.approve(address(platform), 1e6);
        vm.expectEmit(true, false, false, true, address(platform));
        emit PlatformStore.SharesDeposited(issuer, 1e18, 1e6);
        uint256 shares = platform.deposit(1e6);
        platform.setAllowlist(issuer, false);
        vm.expectRevert(PlatformShare.Blocked.selector);
        platform.deposit(1e6);
        vm.expectRevert(PlatformShare.NotAllowlisted.selector);
        IERC20(share).transfer(investor, 1);
        uint256 id = platform.requestRedeem(shares);
        vm.stopPrank();
        assertEq(shares, 1e18);
        assertEq(id, 1);
        assertEq(uint256(platform.getRequest(id).status), uint256(IIssuerFund.RequestStatus.Queued));
        assertTrue(PlatformShare(share).blocked(issuer));
    }

    function test_emptyWindowEmitsTheRoll() public {
        vm.prank(owner);
        WeeklyCyclePlatform platform =
            WeeklyCyclePlatform(factory.createPlatform(QueueKind.WeeklyCycle, "Roll", 600, 1e6, issuer, 1, 0));
        uint64 opened = platform.nextWindow();
        vm.warp(opened);
        vm.expectEmit(true, false, false, true, address(platform));
        emit PlatformStore.WindowProcessed(2, opened + platform.windowInterval(), true);
        platform.processWindow();
        assertEq(platform.currentCycleId(), 2);
    }
}
