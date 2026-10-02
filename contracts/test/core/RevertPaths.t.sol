// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC20Errors} from "@openzeppelin/contracts/interfaces/draft-IERC6093.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {CoreFixture, StubSource} from "./Support.sol";
import {ILockgateCreditLine} from "../../src/interfaces/ILockgateCreditLine.sol";
import {IIssuerFund} from "../../src/interfaces/IIssuerFund.sol";
import {IPricingEngine} from "../../src/interfaces/IPricingEngine.sol";
import {QueueKind} from "../../src/interfaces/IQueueAdapter.sol";
import {CreditLineAdmin} from "../../src/core/CreditLineAdmin.sol";
import {LockgateCreditLine} from "../../src/core/LockgateCreditLine.sol";
import {PlatformReserve} from "../../src/core/PlatformReserve.sol";
import {PlatformStore} from "../../src/core/PlatformStore.sol";
import {PlatformShare} from "../../src/core/PlatformShare.sol";
import {PricingEngine} from "../../src/core/PricingEngine.sol";
import {OpenCreditVault} from "../../src/core/OpenCreditVault.sol";
import {LockgateExitPool} from "../../src/core/LockgateExitPool.sol";
import {MockUSDG} from "../../src/core/MockUSDG.sol";
import {FundFactory} from "../../src/core/FundFactory.sol";
import {WeeklyCyclePlatform} from "../../src/core/WeeklyCyclePlatform.sol";

/// @notice Exact selectors for revert branches the other core suites do not name.
contract RevertPathsTest is CoreFixture {
    function setUp() public {
        _core();
    }

    function test_lineZerosBadParamsAndUnknownSource() public {
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableInvalidOwner.selector, address(0)));
        new LockgateCreditLine(address(0), address(adapter), address(pricing), address(reserve));
        vm.expectRevert(CreditLineAdmin.ZeroAddress.selector);
        new LockgateCreditLine(owner, address(0), address(pricing), address(reserve));
        vm.expectRevert(CreditLineAdmin.ZeroAddress.selector);
        new LockgateCreditLine(owner, address(adapter), address(0), address(reserve));
        vm.expectRevert(CreditLineAdmin.ZeroAddress.selector);
        new LockgateCreditLine(owner, address(adapter), address(pricing), address(0));

        vm.startPrank(owner);
        vm.expectRevert(CreditLineAdmin.ZeroAddress.selector);
        line.registerSource(address(0), 1, 0);
        vm.expectRevert(CreditLineAdmin.ZeroAmount.selector);
        line.depositCapital(0);
        vm.expectRevert(CreditLineAdmin.ZeroAmount.selector);
        line.withdrawCapital(0);
        vm.expectRevert(CreditLineAdmin.BadParam.selector);
        line.setCaps(10_001, 10_000);
        vm.expectRevert(CreditLineAdmin.BadParam.selector);
        line.setCaps(10_000, 10_001);
        vm.stopPrank();

        StubSource stub = _stub(1_000_000e6, 0);
        vm.expectRevert(CreditLineAdmin.ZeroAmount.selector);
        stub.draw(0, investor, type(uint256).max);
        vm.startPrank(owner);
        vm.expectRevert(CreditLineAdmin.BadParam.selector);
        line.setSourceTerms(address(stub), 1, 10_001, 0);
        vm.expectRevert(CreditLineAdmin.BadParam.selector);
        line.setSourceTerms(address(stub), 1, 0, 10_001);
        vm.expectRevert(CreditLineAdmin.Unregistered.selector);
        line.setSourceTerms(stranger, 1, 0, 0);
        vm.expectRevert(CreditLineAdmin.Unregistered.selector);
        line.deregisterSource(stranger);
        vm.stopPrank();
    }

    function test_secondRepayOfAClearedLateAdvance() public {
        StubSource stub = _stub(1_000_000e6, 0);
        (uint256 id,) = stub.draw(100e6, investor, type(uint256).max);
        uint64 due = line.getAdvance(id).dueAt;
        vm.warp(uint256(due) + line.graceOf(id));
        line.markLate(id);
        _mint(address(stub), 100e6);
        line.repay(id);
        assertEq(line.remainingOf(id), 0);
        assertEq(uint256(line.getAdvance(id).status), uint256(ILockgateCreditLine.AdvanceStatus.Late));
        vm.expectRevert(CreditLineAdmin.AlreadySettled.selector);
        line.repay(id);
    }

    function test_pauseCycleAndZeroOwner() public {
        vm.prank(owner);
        vm.expectRevert(Pausable.ExpectedPause.selector);
        line.unpause();
        vm.startPrank(owner);
        line.pause();
        vm.expectRevert(Pausable.EnforcedPause.selector);
        line.pause();
        vm.expectRevert(Pausable.EnforcedPause.selector);
        line.registerSource(stranger, 1, 0);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableInvalidOwner.selector, address(0)));
        line.transferOwnership(address(0));
        vm.stopPrank();
        assertEq(line.owner(), owner);
    }

    function test_reserveZerosAndOverBalance() public {
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableInvalidOwner.selector, address(0)));
        new PlatformReserve(address(0), address(adapter));
        vm.expectRevert(PlatformReserve.ZeroAddress.selector);
        new PlatformReserve(owner, address(0));
        vm.prank(owner);
        vm.expectRevert(PlatformReserve.ZeroAddress.selector);
        reserve.setCreditLine(address(0));
        vm.prank(issuer);
        vm.expectRevert(PlatformReserve.ZeroAddress.selector);
        reserve.post(address(0), 1);
        vm.prank(issuer);
        vm.expectRevert(PlatformReserve.ZeroAmount.selector);
        reserve.post(issuer, 0);

        StubSource stub = _stub(1, 0);
        vm.prank(address(stub));
        vm.expectRevert(PlatformReserve.ZeroAmount.selector);
        line.postReserve(address(stub), 0);
        _post(address(stub), 1e6);
        vm.prank(address(stub));
        reserve.setAdmin(address(stub), issuer);
        vm.prank(issuer);
        vm.expectRevert(PlatformReserve.ZeroAmount.selector);
        reserve.withdraw(address(stub), 0);
        vm.prank(issuer);
        vm.expectRevert(abi.encodeWithSelector(PlatformReserve.OverBalance.selector, 1e6 + 1, 1e6));
        reserve.withdraw(address(stub), 1e6 + 1);
        assertEq(reserve.balanceOf(address(stub)), 1e6);
    }

    function test_vaultPoolAndMockZeros() public {
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableInvalidOwner.selector, address(0)));
        new OpenCreditVault(address(0), address(usdg), false);
        vm.expectRevert(OpenCreditVault.ZeroAddress.selector);
        new OpenCreditVault(owner, address(0), false);
        OpenCreditVault vault = new OpenCreditVault(owner, address(usdg), false);
        vm.expectRevert(OpenCreditVault.ZeroAmount.selector);
        vault.deposit(0);
        _mint(investor, 10e6);
        vm.startPrank(investor);
        usdg.approve(address(vault), 10e6);
        vault.deposit(10e6);
        vm.expectRevert(OpenCreditVault.ZeroAmount.selector);
        vault.requestWithdraw(0);
        vm.expectRevert(OpenCreditVault.ZeroAmount.selector);
        vault.requestWithdraw(1);
        uint256 held = vault.balanceOf(investor);
        vm.expectRevert(abi.encodeWithSelector(IERC20Errors.ERC20InsufficientBalance.selector, investor, held, held + 1));
        vault.requestWithdraw(held + 1);
        vm.stopPrank();

        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableInvalidOwner.selector, address(0)));
        new LockgateExitPool(address(0), address(vault), address(line));
        vm.expectRevert(LockgateExitPool.ZeroAddress.selector);
        new LockgateExitPool(owner, address(0), address(line));
        vm.expectRevert(LockgateExitPool.ZeroAddress.selector);
        new LockgateExitPool(owner, address(vault), address(0));
        LockgateExitPool pool = new LockgateExitPool(owner, address(vault), address(line));
        vm.prank(owner);
        line.registerSource(address(pool), 1_000_000e6, 0);
        vm.expectRevert(LockgateExitPool.ZeroAmount.selector);
        pool.sellToLockgate(1, 0);

        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableInvalidOwner.selector, address(0)));
        new MockUSDG(address(0));
        vm.prank(owner);
        vm.expectRevert(MockUSDG.ZeroAddress.selector);
        usdg.setMinter(address(0), true);
    }

    function test_factoryImplZeros() public {
        address place = address(1);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableInvalidOwner.selector, address(0)));
        new FundFactory(address(0), address(adapter), address(line), address(reserve), place, place, place);
        vm.expectRevert(FundFactory.ZeroAddress.selector);
        new FundFactory(owner, address(adapter), address(line), address(reserve), place, address(0), place);
        vm.expectRevert(FundFactory.ZeroAddress.selector);
        new FundFactory(owner, address(adapter), address(line), address(reserve), place, place, address(0));
    }

    function test_remainingParamReasons() public {
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableInvalidOwner.selector, address(0)));
        new PricingEngine(address(0));
        _bad("fee", _fee(2_000, 1_000));
        _bad("fee", _fee(25, 10_001));
        _bad("nav", _nav(0, 1 days));
        IPricingEngine.Params memory warn = pricing.params();
        warn.maxNavAge = 1 days;
        warn.navWarnSeconds = 2 days;
        _bad("nav", warn);
        _bad("concentration", _cap(0));
        _bad("concentration", _cap(10_001));
        _bad("tenor", _tenor(0));
        IPricingEngine.Params memory kink = pricing.params();
        kink.kinkUtilBps = 10_000;
        _bad("kink", kink);
        IPricingEngine.Params memory scale = pricing.params();
        scale.timeScale = 1_000_001;
        _bad("scale", scale);
        IPricingEngine.Params memory curve = pricing.params();
        curve.aprAtFullBps = curve.aprAtKinkBps - 1;
        _bad("curve", curve);
        IPricingEngine.Params memory year = pricing.params();
        year.yearSeconds = 367 days;
        _bad("year", year);
    }

    function test_platformZerosAndExitGuards() public {
        vm.prank(owner);
        WeeklyCyclePlatform platform = WeeklyCyclePlatform(
            factory.createPlatform(QueueKind.WeeklyCycle, "Zeros", 600, 1e6, issuer, 1_000_000e6, 0)
        );
        vm.expectRevert(PlatformStore.ZeroAmount.selector);
        platform.deposit(0);
        vm.expectRevert(PlatformStore.ZeroAmount.selector);
        platform.depositCash(0);
        vm.prank(issuer);
        platform.setNav(1e18 + 1);
        vm.expectRevert(PlatformStore.ZeroAmount.selector);
        platform.deposit(1);
        vm.prank(issuer);
        platform.setNav(1e6);
        vm.expectRevert(PlatformStore.ZeroAmount.selector);
        platform.requestRedeem(0);
        vm.expectRevert(PlatformStore.ZeroAmount.selector);
        platform.requestRedeem(1);
        vm.expectRevert(abi.encodeWithSelector(IERC20Errors.ERC20InsufficientBalance.selector, address(this), 0, 1e18));
        platform.requestRedeem(1e18);

        _mint(investor, 20e6);
        vm.startPrank(investor);
        usdg.approve(address(platform), 20e6);
        platform.deposit(20e6);
        uint256 queued = platform.requestRedeem(10e18);
        vm.stopPrank();
        vm.prank(stranger);
        vm.expectRevert(PlatformStore.NotOwner.selector);
        platform.exitEarly(queued, 0);
        vm.prank(issuer);
        platform.setGated(true);
        vm.prank(investor);
        vm.expectRevert(abi.encodeWithSelector(PlatformStore.NotAvailable.selector, "gated"));
        platform.exitEarly(queued, 0);
        vm.prank(issuer);
        platform.setGated(false);
        vm.prank(investor);
        (uint256 advanced,) = platform.exitNow(10e18, 0);
        vm.prank(investor);
        vm.expectRevert(PlatformStore.BadStatus.selector);
        platform.exitEarly(advanced, 0);
        assertEq(uint256(platform.getRequest(advanced).status), uint256(IIssuerFund.RequestStatus.Advanced));

        vm.expectRevert(PlatformShare.ZeroAddress.selector);
        new PlatformShare("Zeros", address(0));
        PlatformShare share = platform.shareToken();
        vm.prank(address(platform));
        vm.expectRevert(PlatformShare.NotAllowlisted.selector);
        share.mint(stranger, 1);
        vm.prank(address(platform));
        vm.expectRevert(abi.encodeWithSelector(IERC20Errors.ERC20InsufficientBalance.selector, stranger, 0, 1));
        share.burn(stranger, 1);
    }

    function _bad(string memory reason, IPricingEngine.Params memory next) internal {
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(PricingEngine.BadParams.selector, reason));
        pricing.setParams(next);
    }

    function _fee(uint16 minFee, uint16 maxFee) internal view returns (IPricingEngine.Params memory next) {
        next = pricing.params();
        next.minFeeBps = minFee;
        next.maxFeeBps = maxFee;
    }

    function _nav(uint64 maxAge, uint64 warn) internal view returns (IPricingEngine.Params memory next) {
        next = pricing.params();
        next.maxNavAge = maxAge;
        next.navWarnSeconds = warn;
    }

    function _cap(uint16 cap) internal view returns (IPricingEngine.Params memory next) {
        next = pricing.params();
        next.concentrationCapBps = cap;
    }

    function _tenor(uint64 tenor) internal view returns (IPricingEngine.Params memory next) {
        next = pricing.params();
        next.maxTenorSeconds = tenor;
    }
}
