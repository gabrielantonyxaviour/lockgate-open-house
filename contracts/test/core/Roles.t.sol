// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {CoreFixture, StubSource} from "./Support.sol";
import {CreditLineAdmin} from "../../src/core/CreditLineAdmin.sol";
import {ILockgateCreditLine} from "../../src/interfaces/ILockgateCreditLine.sol";

/// @notice Grant, revoke, and renounce leave an open advance repayable and its cash withdrawable.
contract RolesTest is CoreFixture {
    function setUp() public {
        _core();
    }

    function test_grantRevokeAndRenounceLeaveRepayAndCashReachable() public {
        StubSource stub = _stub(1_000_000e6, 750);
        _post(address(stub), 20e6);
        address clerk = makeAddr("clerk");
        address extra = makeAddr("extraSlash");

        vm.startPrank(owner);
        line.setRegistrar(clerk, true);
        line.setRegistrar(clerk, false);
        line.setRegistrar(address(factory), false);
        reserve.setSlasher(extra, true);
        reserve.setSlasher(extra, false);
        reserve.setSlasher(address(line), false);
        reserve.renounceOwnership();
        vm.stopPrank();

        assertFalse(line.registrars(clerk));
        assertFalse(line.registrars(address(factory)));
        assertTrue(line.registered(address(stub)));
        assertFalse(reserve.isSlasher(extra));
        assertFalse(reserve.isSlasher(address(line)));
        assertEq(reserve.owner(), address(0));

        vm.startPrank(address(stub));
        reserve.setAdmin(address(stub), issuer);
        reserve.setAdmin(address(stub), address(0));
        vm.stopPrank();
        assertEq(reserve.adminOf(address(stub)), address(0));

        vm.prank(owner);
        vm.expectRevert(CreditLineAdmin.RenounceDisabled.selector);
        line.renounceOwnership();
        assertEq(line.owner(), owner);

        (uint256 id, uint256 fee) = stub.draw(100e6, investor, type(uint256).max);
        assertEq(fee, 990_000);
        assertEq(usdg.balanceOf(investor), 99_010_000);
        _mint(address(stub), 100e6);
        vm.prank(stranger);
        line.repay(id);

        assertEq(line.remainingOf(id), 0);
        assertEq(line.earnedFees(), fee);
        assertEq(line.outstanding(), 0);
        assertEq(line.capital(), 500_000e6 + fee);
        assertEq(uint256(line.getAdvance(id).status), uint256(ILockgateCreditLine.AdvanceStatus.Repaid));
        assertEq(line.requiredReserve(address(stub)), 0);
        assertEq(reserve.balanceOf(address(stub)), 20e6);
        assertEq(line.accountedAssets(), line.accountedEquity());

        uint256 ownerBefore = usdg.balanceOf(owner);
        vm.prank(owner);
        line.withdrawCapital(500_000e6 + fee);
        assertEq(usdg.balanceOf(owner) - ownerBefore, 500_000e6 + fee);
        assertEq(line.capital(), 0);
        assertEq(line.accountedAssets(), line.accountedEquity());

        vm.prank(address(stub));
        reserve.withdraw(address(stub), 20e6);
        assertEq(reserve.balanceOf(address(stub)), 0);
        assertEq(reserve.totalBalances(), 0);
        assertEq(usdg.balanceOf(address(stub)), 20e6);
        assertEq(usdg.balanceOf(investor), 99_010_000);
    }
}
