// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";
import {CoreFixture, StubSource} from "./Support.sol";
import {IIssuerFund} from "../../src/interfaces/IIssuerFund.sol";
import {IPricingEngine} from "../../src/interfaces/IPricingEngine.sol";
import {QueueKind} from "../../src/interfaces/IQueueAdapter.sol";
import {CreditLineAdmin} from "../../src/core/CreditLineAdmin.sol";
import {FundFactory} from "../../src/core/FundFactory.sol";
import {LockgateExitPool} from "../../src/core/LockgateExitPool.sol";
import {OpenCreditVault} from "../../src/core/OpenCreditVault.sol";
import {PlatformBase} from "../../src/core/PlatformBase.sol";
import {PlatformConfig} from "../../src/core/PlatformConfig.sol";
import {PlatformShare} from "../../src/core/PlatformShare.sol";
import {PlatformStore} from "../../src/core/PlatformStore.sol";
import {WeeklyCyclePlatform} from "../../src/core/WeeklyCyclePlatform.sol";

/// @notice Attacker paths the threat model names. Each refusal leaves the book where it was.
contract ThreatGapsTest is CoreFixture {
    StubSource internal stub;

    function setUp() public {
        _core();
        stub = _stub(1_000_000e6, 750);
    }

    function test_tenorBoundaryRefusesTheDraw() public {
        _post(address(stub), 20e6);
        uint64 nowTs = uint64(block.timestamp);
        uint256 capitalBefore = line.capital();

        stub.setWindow(nowTs + uint64(366 days));
        (uint256 refusedFee, uint16 refusedBps, bool refused, string memory why) = line.quote(address(stub), 100e6);
        assertFalse(refused);
        assertEq(refusedFee, 0);
        assertEq(refusedBps, 0);
        assertEq(why, "fee above max");
        (uint16 model, bool modelOk, string memory modelWhy) = pricing.feeBps(366 days, 0, false, 10_000, 0);
        assertFalse(modelOk);
        assertEq(modelWhy, "fee above max");
        assertEq(model, 1500);
        vm.expectRevert(CreditLineAdmin.FeeAboveMax.selector);
        stub.draw(100e6, investor, type(uint256).max);

        stub.setWindow(nowTs + uint64(366 days) + 1);
        (,,, why) = line.quote(address(stub), 100e6);
        assertEq(why, "tenor");
        vm.expectRevert(CreditLineAdmin.Tenor.selector);
        stub.draw(100e6, investor, type(uint256).max);
        assertEq(line.advanceCount(), 0);
        assertEq(line.capital(), capitalBefore);

        IPricingEngine.Params memory p = pricing.params();
        p.timeScale = 1;
        vm.prank(owner);
        pricing.setParams(p);
        stub.setWindow(nowTs + uint64(366 days));
        (uint256 fee, uint16 bps, bool available, string memory openWhy) = line.quote(address(stub), 100e6);
        assertTrue(available, openWhy);
        assertEq(bps, 1203);
        assertEq(fee, 12_030_000);
        stub.draw(100e6, investor, type(uint256).max);
        assertEq(line.advanceCount(), 1);
        assertEq(line.exposure(address(stub)), 100e6);

        stub.setWindow(nowTs + uint64(366 days) + 1);
        vm.expectRevert(CreditLineAdmin.Tenor.selector);
        stub.draw(100e6, investor, type(uint256).max);
        assertEq(line.advanceCount(), 1);
        assertEq(line.exposure(address(stub)), 100e6);
    }

    function test_strangerCannotMoveSharesOrIssuerControls() public {
        vm.prank(owner);
        WeeklyCyclePlatform platform = WeeklyCyclePlatform(
            factory.createPlatform(QueueKind.WeeklyCycle, "Gate", 600, 1e6, issuer, 1_000_000e6, 0)
        );
        PlatformShare share = platform.shareToken();
        vm.prank(stranger);
        vm.expectRevert(PlatformShare.NotPlatform.selector);
        share.mint(stranger, 1);
        vm.prank(stranger);
        vm.expectRevert(PlatformShare.NotPlatform.selector);
        share.burn(issuer, 1);
        vm.prank(stranger);
        vm.expectRevert(PlatformShare.NotPlatform.selector);
        share.pull(issuer, stranger, 1);
        vm.prank(stranger);
        vm.expectRevert(PlatformShare.NotPlatform.selector);
        share.setAllowlist(stranger, true);
        vm.prank(issuer);
        vm.expectRevert(PlatformShare.ZeroAddress.selector);
        platform.setAllowlist(address(0), true);

        vm.prank(stranger);
        vm.expectRevert(PlatformStore.NotIssuer.selector);
        platform.setNav(2e6);
        vm.prank(stranger);
        vm.expectRevert(PlatformStore.NotIssuer.selector);
        platform.setGated(true);
        vm.prank(stranger);
        vm.expectRevert(PlatformStore.NotIssuer.selector);
        platform.setAllowlist(stranger, true);
        assertEq(platform.nav(), 1e6);
        assertFalse(platform.gated());

        _mint(investor, 10e6);
        vm.startPrank(investor);
        usdg.approve(address(platform), 10e6);
        platform.deposit(10e6);
        uint256 id = platform.requestRedeem(10e18);
        vm.stopPrank();
        vm.prank(stranger);
        vm.expectRevert(PlatformStore.NotOwner.selector);
        platform.cancel(id);
        assertEq(platform.queueLength(), 1);
        assertEq(share.balanceOf(address(platform)), 10e18);
        vm.prank(investor);
        platform.cancel(id);
        assertEq(platform.queueLength(), 0);
        assertEq(share.balanceOf(investor), 10e18);

        vm.prank(owner);
        vm.expectRevert(CreditLineAdmin.ZeroAddress.selector);
        line.setRegistrar(address(0), true);
        assertFalse(line.registrars(address(0)));
    }

    function test_exitEarlyWithoutReserveStaysQueued() public {
        vm.prank(owner);
        WeeklyCyclePlatform platform = WeeklyCyclePlatform(
            factory.createPlatform(QueueKind.WeeklyCycle, "Thin", 600, 1e6, issuer, 1_000_000e6, 750)
        );
        _mint(investor, 10e6);
        vm.startPrank(investor);
        usdg.approve(address(platform), 10e6);
        platform.deposit(10e6);
        uint256 id = platform.requestRedeem(10e18);
        vm.expectRevert(abi.encodeWithSelector(PlatformStore.NotAvailable.selector, "reserve"));
        platform.exitEarly(id, 0);
        vm.stopPrank();
        assertEq(uint256(platform.getRequest(id).status), uint256(IIssuerFund.RequestStatus.Queued));
        assertEq(platform.shareToken().balanceOf(address(platform)), 10e18);
        assertEq(line.advanceCount(), 0);
    }

    function test_pausedLineBlocksThePoolSale() public {
        OpenCreditVault vault = new OpenCreditVault(owner, address(usdg), false);
        LockgateExitPool pool = new LockgateExitPool(owner, address(vault), address(line));
        vm.prank(owner);
        line.registerSource(address(pool), 1_000_000e6, 0);
        _mint(investor, 10e6);
        vm.startPrank(investor);
        usdg.approve(address(vault), 10e6);
        uint256 shares = vault.deposit(10e6);
        IERC20(address(vault)).approve(address(pool), shares);
        vm.stopPrank();
        vm.prank(owner);
        line.pause();
        vm.prank(investor);
        vm.expectRevert(abi.encodeWithSelector(LockgateExitPool.NotAvailable.selector, "paused"));
        pool.sellToLockgate(shares, 0);
        assertEq(vault.balanceOf(investor), shares);
        assertEq(pool.positionCount(), 0);
    }

    function test_vaultClaimWaitsAndFullRedeemFits() public {
        OpenCreditVault vault = new OpenCreditVault(owner, address(usdg), false);
        _mint(investor, 100e6);
        vm.startPrank(investor);
        usdg.approve(address(vault), 100e6);
        uint256 shares = vault.deposit(100e6);
        uint256 id = vault.requestWithdraw(shares);
        vm.stopPrank();
        assertEq(vault.assets(), 0);
        assertEq(vault.totalSupply(), 0);
        assertEq(usdg.balanceOf(address(vault)), 100e6);
        vm.expectRevert(OpenCreditVault.UnknownWithdrawal.selector);
        vault.claim(id + 1);
        vm.expectRevert(OpenCreditVault.NotReady.selector);
        vault.claim(id);
        uint64 readyAt = _readyAt(vault, id);
        vm.warp(readyAt);
        uint256 paid = vault.claim(id);
        assertEq(paid, 100e6);
        assertEq(usdg.balanceOf(investor), 100e6);
        assertEq(usdg.balanceOf(address(vault)), 0);
        vm.expectRevert(OpenCreditVault.AlreadyClaimed.selector);
        vault.claim(id);
    }

    function test_pauseStillAcceptsCapital() public {
        vm.prank(owner);
        line.pause();
        uint256 capitalBefore = line.capital();
        uint256 depositedBefore = line.deposited();
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger));
        line.depositCapital(1e6);
        vm.prank(owner);
        line.depositCapital(1e6);
        assertEq(line.capital(), capitalBefore + 1e6);
        assertEq(line.deposited(), depositedBefore + 1e6);
        assertEq(line.accountedAssets(), line.accountedEquity());
        vm.prank(owner);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        line.withdrawCapital(1e6);
        assertEq(line.capital(), capitalBefore + 1e6);
    }

    function test_freshCloneRejectsAZeroField() public {
        address clone = Clones.clone(factory.weeklyImpl());
        PlatformConfig memory cfg = _cfg();
        cfg.nav = 0;
        _reject(clone, cfg);
        cfg = _cfg();
        cfg.interval = 0;
        _reject(clone, cfg);
        cfg = _cfg();
        cfg.token = address(0);
        _reject(clone, cfg);
        cfg = _cfg();
        cfg.creditLine = address(0);
        _reject(clone, cfg);
        cfg = _cfg();
        cfg.issuer = address(0);
        _reject(clone, cfg);
        cfg = _cfg();
        cfg.initialShares = 1;
        cfg.initialHolder = address(0);
        _reject(clone, cfg);
        assertEq(WeeklyCyclePlatform(clone).issuer(), address(0));
        PlatformBase(clone).initialize(_cfg());
        assertEq(WeeklyCyclePlatform(clone).issuer(), issuer);
        vm.expectRevert(PlatformStore.BadConfig.selector);
        PlatformBase(clone).initialize(_cfg());

        address place = address(1);
        vm.expectRevert(FundFactory.ZeroAddress.selector);
        new FundFactory(owner, address(adapter), address(line), address(reserve), place, address(0), place);
        vm.expectRevert(FundFactory.ZeroAddress.selector);
        new FundFactory(owner, address(adapter), address(line), address(reserve), place, place, address(0));
    }

    function _cfg() internal view returns (PlatformConfig memory cfg) {
        cfg.token = address(usdg);
        cfg.creditLine = address(line);
        cfg.issuer = issuer;
        cfg.nav = 1e6;
        cfg.interval = 600;
        cfg.name = "Clone";
    }

    function _reject(address clone, PlatformConfig memory cfg) internal {
        vm.expectRevert(PlatformStore.BadConfig.selector);
        PlatformBase(clone).initialize(cfg);
    }

    function _readyAt(OpenCreditVault vault, uint256 id) internal view returns (uint64 readyAt) {
        (,,, readyAt,) = vault.withdrawals(id);
    }
}
