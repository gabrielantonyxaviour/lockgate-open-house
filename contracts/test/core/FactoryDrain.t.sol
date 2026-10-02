// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {CoreFixture} from "./Support.sol";
import {QueueKind} from "../../src/interfaces/IQueueAdapter.sol";
import {WeeklyCyclePlatform} from "../../src/core/WeeklyCyclePlatform.sol";

/// @notice Regression for the assessment's critical issue: a permissionless `createPlatform` let anyone register a
///         fund with a self-chosen limit and 0 reserve, mark its NAV up, and draw the line's capital.
contract FactoryDrainTest is CoreFixture {
    function setUp() public {
        _core();
    }

    /// @dev The original attack, step by step. Step one (self-registration) now reverts, so nothing after it can run.
    function test_attackerCannotSelfRegisterAndDrainTheLine() public {
        uint256 lineBefore = usdg.balanceOf(address(line));
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger));
        factory.createPlatform(QueueKind.WeeklyCycle, "Drain", 600, 1e6, stranger, type(uint128).max, 0);

        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger));
        factory.createDemoFund("Drain demo", stranger);

        assertEq(factory.allFunds().length, 0);
        assertEq(line.sources().length, 0);
        assertEq(usdg.balanceOf(address(line)), lineBefore);
    }

    /// @dev What the attack did before the fix, replayed through the only path left: the owner. The attacker as
    ///      issuer can still mark NAV up, but the draw is capped by the limit and reserve Lockgate chose.
    function test_ownerSetTermsBoundAMarkedUpNav() public {
        vm.prank(owner);
        WeeklyCyclePlatform fund = WeeklyCyclePlatform(
            factory.createPlatform(QueueKind.WeeklyCycle, "Bounded", 600, 1e6, stranger, 1_000e6, 750)
        );
        assertEq(fund.issuer(), stranger);
        assertEq(line.limitOf(address(fund)), 1_000e6);
        assertEq(line.reserveBpsOf(address(fund)), 750);
        _post(address(fund), 75e6);
        _mint(stranger, 1e6);
        vm.startPrank(stranger);
        usdg.approve(address(fund), 1e6);
        fund.deposit(1e6);
        fund.setNav(1_000_000e6);
        uint256 shares = IERC20(fund.share()).balanceOf(stranger);
        uint256 lineBefore = usdg.balanceOf(address(line));
        vm.expectRevert();
        fund.exitNow(shares, 0);
        vm.stopPrank();
        assertEq(usdg.balanceOf(address(line)), lineBefore);
    }

    function test_ownerPathCreatesAndRegisters() public {
        vm.prank(owner);
        address fund = factory.createPlatform(QueueKind.Epoch, "Owner epoch", 600, 1e6, issuer, 5_000e6, 500);
        assertEq(WeeklyCyclePlatform(fund).issuer(), issuer);
        assertEq(line.limitOf(fund), 5_000e6);
        assertEq(line.reserveBpsOf(fund), 500);
        assertEq(factory.fundsOf(issuer).length, 1);

        vm.prank(owner);
        address demo = factory.createDemoFund("Owner demo", issuer);
        assertEq(WeeklyCyclePlatform(demo).issuer(), issuer);
        assertEq(line.limitOf(demo), factory.DEMO_LIMIT());
        assertGt(IERC20(WeeklyCyclePlatform(demo).share()).balanceOf(issuer), 0);
    }

    function test_ownerCannotCreateForTheZeroIssuer() public {
        vm.startPrank(owner);
        vm.expectRevert(bytes4(keccak256("ZeroAddress()")));
        factory.createPlatform(QueueKind.WeeklyCycle, "Zero", 600, 1e6, address(0), 1, 0);
        vm.expectRevert(bytes4(keccak256("ZeroAddress()")));
        factory.createDemoFund("Zero", address(0));
        vm.stopPrank();
    }
}
