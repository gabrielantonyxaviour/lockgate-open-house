// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {CoreFixture} from "./Support.sol";
import {QueueKind} from "../../src/interfaces/IQueueAdapter.sol";
import {ILockgateCreditLine} from "../../src/interfaces/ILockgateCreditLine.sol";
import {FundFactory} from "../../src/core/FundFactory.sol";
import {UsdgAdapter} from "../../src/core/UsdgAdapter.sol";
import {PlatformConfig} from "../../src/core/PlatformConfig.sol";
import {PlatformStore} from "../../src/core/PlatformStore.sol";
import {WeeklyCyclePlatform} from "../../src/core/WeeklyCyclePlatform.sol";
import {EpochQueuePlatform} from "../../src/core/EpochQueuePlatform.sol";
import {QuarterlyWindowPlatform} from "../../src/core/QuarterlyWindowPlatform.sol";

contract FactoryDemoTest is CoreFixture {
    function setUp() public {
        _core();
    }

    function test_demoSeedAndExitClearsOnTheWindow() public {
        vm.prank(issuer);
        QuarterlyWindowPlatform platform = QuarterlyWindowPlatform(factory.createDemoFund("Harbour Credit"));
        assertEq(platform.issuer(), issuer);
        assertEq(platform.nav(), 1_023_400);
        assertEq(platform.cash(), 2_000e6);
        assertEq(uint8(platform.kind()), uint8(QueueKind.QuarterlyGated));
        assertEq(line.limitOf(address(platform)), 25_000e6);
        assertEq(line.reserveBpsOf(address(platform)), 750);
        assertEq(reserve.balanceOf(address(platform)), 1_875e6);
        assertEq(reserve.adminOf(address(platform)), issuer);
        uint256 shares = uint256(10_000e6) * 1e18 / 1_023_400;
        assertEq(IERC20(platform.share()).balanceOf(issuer), shares);
        assertEq(factory.fundsOf(issuer).length, 1);
        assertEq(factory.allFunds()[0], address(platform));

        vm.prank(issuer);
        (uint256 requestId, uint256 payout) = platform.exitNow(shares, 0);
        uint256 advanceId = platform.getRequest(requestId).advanceId;
        ILockgateCreditLine.Advance memory advance = line.getAdvance(advanceId);
        assertEq(advance.principal + advance.fee, platform.getRequest(requestId).navValue);
        assertEq(payout, advance.principal);
        assertEq(line.earnedFees(), 0);
        uint256 owed = line.remainingOf(advanceId);
        uint256 have = platform.cash();
        _mint(issuer, owed - have);
        vm.startPrank(issuer);
        usdg.approve(address(platform), owed - have);
        platform.depositCash(owed - have);
        vm.stopPrank();
        vm.warp(platform.nextWindow());
        platform.processWindow();
        assertEq(line.remainingOf(advanceId), 0);
        assertEq(line.earnedFees(), advance.fee);
        assertEq(uint256(line.getAdvance(advanceId).status), uint256(ILockgateCreditLine.AdvanceStatus.Repaid));
        assertEq(platform.shareToken().balanceOf(address(platform)), 0);
        assertEq(line.accountedAssets(), line.accountedEquity());
    }

    function test_realAdapterCannotMintTheDemo() public {
        UsdgAdapter realish = new UsdgAdapter(address(usdg), false);
        FundFactory other = _factory(address(realish));
        vm.prank(issuer);
        vm.expectRevert(FundFactory.DemoRequiresMock.selector);
        other.createDemoFund("nope");
    }

    function test_createPlatformDoesNotSeedCash() public {
        vm.prank(issuer);
        address fund = factory.createPlatform(QueueKind.WeeklyCycle, "Bare", 600, 1e6, 5_000e6, 500);
        assertEq(IERC20(usdg).balanceOf(fund), 0);
        assertEq(reserve.balanceOf(fund), 0);
        assertEq(line.limitOf(fund), 5_000e6);
        vm.prank(issuer);
        vm.expectRevert(FundFactory.BadKind.selector);
        factory.createPlatform(QueueKind.None, "none", 600, 1e6, 1, 0);
    }

    /// @dev EIP-170 deployed max is 24576. EIP-3860 init max is 49152.
    function test_factoryFitsBothSizeLimits() public view {
        assertLe(address(factory).code.length, 24_576);
        assertLe(factory.weeklyImpl().code.length, 24_576);
        assertLe(factory.epochImpl().code.length, 24_576);
        assertLe(factory.quarterImpl().code.length, 24_576);
        assertLe(type(FundFactory).creationCode.length + 7 * 32, 49_152);
        PlatformConfig memory blank;
        uint256 initArgs = abi.encode(blank).length;
        assertLe(type(WeeklyCyclePlatform).creationCode.length + initArgs, 49_152);
        assertLe(type(EpochQueuePlatform).creationCode.length + initArgs, 49_152);
        assertLe(type(QuarterlyWindowPlatform).creationCode.length + initArgs, 49_152);
    }

    function test_initializeIsOnceOnTheCloneAndTheImplementation() public {
        vm.prank(issuer);
        address fund = factory.createPlatform(QueueKind.WeeklyCycle, "Once", 600, 1e6, 1, 0);
        PlatformConfig memory cfg;
        cfg.token = address(usdg);
        cfg.creditLine = address(line);
        cfg.issuer = issuer;
        cfg.nav = 1e6;
        cfg.interval = 600;
        vm.expectRevert(PlatformStore.BadConfig.selector);
        WeeklyCyclePlatform(fund).initialize(cfg);
        address impl = factory.weeklyImpl();
        vm.expectRevert(PlatformStore.BadConfig.selector);
        WeeklyCyclePlatform(impl).initialize(cfg);
    }
}
