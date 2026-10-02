// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AdvanceProposal} from "../../src/interfaces/IAdvanceProposal.sol";
import {PartnerRouter} from "../../src/partner/PartnerRouter.sol";
import {PartnerVaultAdmin} from "../../src/partner/PartnerVaultAdmin.sol";
import {AdvanceStatus, RejectReason} from "../../src/partner/Types.sol";
import {VaultFixture} from "./VaultFixture.sol";

/// @notice Partner pauses and pulls idle cash while advances are still open.
///         Repayment, a reserve slash, and a write-off then empty the vault.
contract WindDownTest is VaultFixture {
    PartnerRouter internal router;

    function setUp() public {
        _deploy();
        _openMandate();
        router = new PartnerRouter(address(this));
        router.approveVault(address(vault), true);
        vm.startPrank(partner);
        vault.setRouter(address(router));
        router.register(address(vault));
        vm.stopPrank();
    }

    function test_windDownWhileTwoAdvancesAreOpenLeavesNothing() public {
        uint256 deposit = 100_000 * UNIT;
        uint256 posted = 5_000 * UNIT;
        uint256 nav = 10_000 * UNIT;
        _deposit(deposit);
        _reserve(posted);
        AdvanceProposal memory first = _proposal(nav, 1);
        AdvanceProposal memory second = _proposal(nav, 2);
        uint256 firstId = _execute(first);
        uint256 secondId = _execute(second);
        uint256 payout = first.payout;

        AdvanceProposal memory parked = _proposal(nav, 3);
        bytes memory parkedSig = _engineSig(vault, parked);
        vm.prank(lockgate);
        vault.submitProposal(parked, parkedSig);
        vm.startPrank(partner);
        vault.setPaused(true);
        vault.cancel(3);
        vm.stopPrank();
        vm.prank(partner);
        vm.expectRevert(PartnerVaultAdmin.NonceUsed.selector);
        vault.execute(parked, parkedSig, "");

        uint256 idle = vault.idle();
        assertEq(idle, deposit - payout * 2);
        assertEq(vault.outstandingPrincipal(), payout * 2);
        vm.prank(lockgate);
        vm.expectRevert(PartnerVaultAdmin.Unauthorized.selector);
        vault.withdraw(idle, lockgate);
        vm.prank(partner);
        vault.withdraw(idle, partner);
        vm.prank(partner);
        vm.expectRevert(PartnerVaultAdmin.BadParam.selector);
        vault.withdraw(1, partner);
        assertEq(usdg.balanceOf(address(vault)), posted);
        assertEq(usdg.balanceOf(address(router)), 0);

        uint256 required = 1_000 * UNIT;
        uint256 excess = posted - required;
        vm.prank(partner);
        vm.expectRevert(PartnerVaultAdmin.Unauthorized.selector);
        vault.withdrawReserve(platform, 1, partner);
        vm.prank(platform);
        vm.expectRevert(abi.encodeWithSelector(PartnerVaultAdmin.MandateRejected.selector, RejectReason.Reserve));
        vault.withdrawReserve(platform, excess + 1, platform);
        vm.prank(platform);
        vault.withdrawReserve(platform, excess, platform);
        assertEq(vault.reserveOf(platform), required);
        assertEq(usdg.balanceOf(address(vault)), required);
        assertEq(usdg.balanceOf(platform), payout * 2 + excess);

        _pay(firstId);
        _sweep();
        uint256 floorNow = 500 * UNIT;
        uint256 releasable = vault.reserveOf(platform) - floorNow;
        vm.prank(platform);
        vault.withdrawReserve(platform, releasable, platform);

        uint256 routerBefore = usdg.balanceOf(address(router));
        _relay(secondId, second.quoteId);
        assertEq(usdg.balanceOf(address(router)), routerBefore);
        _sweep();
        uint256 reserveLeft = vault.reserveOf(platform);
        vm.prank(platform);
        vault.withdrawReserve(platform, reserveLeft, platform);

        assertEq(vault.idle(), 0);
        assertEq(vault.reserveCash(), 0);
        assertEq(vault.outstandingPrincipal(), 0);
        assertEq(vault.exposureOf(platform), 0);
        assertEq(vault.totalShares(), 0);
        assertEq(usdg.balanceOf(address(vault)), 0);
        assertEq(usdg.balanceOf(partner), deposit + first.fee + second.fee);
        assertEq(usdg.balanceOf(platform), posted - first.fee - second.fee);
        assertEq(usdg.balanceOf(partner) + usdg.balanceOf(platform), deposit + posted);
    }

    function test_windDownWriteOffLeavesTheShortfallOffTheBooks() public {
        uint256 deposit = 50_000 * UNIT;
        uint256 posted = 1_000 * UNIT;
        _deposit(deposit);
        _reserve(posted);
        AdvanceProposal memory opened = _proposal(10_000 * UNIT, 1);
        uint256 id = _execute(opened);
        vm.prank(partner);
        vault.setPaused(true);
        uint256 idle = vault.idle();
        vm.prank(partner);
        vault.withdraw(idle, partner);
        assertEq(usdg.balanceOf(address(vault)), posted);
        assertEq(vault.outstandingPrincipal(), opened.payout);

        uint64 due = vault.getAdvance(id).dueAt;
        uint64 grace = vault.graceOf(id);
        vm.warp(uint256(due) + grace);
        vault.markLate(id);
        assertEq(vault.reserveCash(), 0);
        assertEq(vault.idle(), posted);
        assertEq(uint256(vault.getAdvance(id).status), uint256(AdvanceStatus.Late));
        uint256 shortfall = vault.owedOf(id);
        assertEq(shortfall, opened.navValue - posted);
        assertEq(vault.outstandingPrincipal(), opened.payout - (posted - opened.fee));

        vm.prank(partner);
        vault.withdraw(posted, partner);
        vm.prank(partner);
        vault.writeOff(id);
        assertEq(uint256(vault.getAdvance(id).status), uint256(AdvanceStatus.WrittenOff));
        assertEq(vault.outstandingPrincipal(), 0);
        assertEq(vault.exposureOf(platform), 0);
        assertEq(vault.idle(), 0);
        assertGt(vault.totalShares(), 0);
        assertEq(usdg.balanceOf(address(vault)), 0);
        assertEq(usdg.balanceOf(partner), idle + posted);
        assertEq(usdg.balanceOf(platform), opened.payout);
        assertEq(usdg.balanceOf(partner) + usdg.balanceOf(platform), deposit + posted);
    }

    function test_oneWeiSweepsAfterRepayDoNotStrandTheFee() public {
        vm.prank(partner);
        vault.setPlatform(platform, true, 10_000_000 * UNIT, 0, false, 1 days);
        _deposit(1_000);
        AdvanceProposal memory opened = _proposal(100, 1);
        uint256 id = _execute(opened);
        vm.prank(partner);
        vault.setPaused(true);
        uint256 idle = vault.idle();
        vm.prank(partner);
        vault.withdraw(idle, partner);
        assertEq(usdg.balanceOf(address(vault)), 0);
        assertEq(vault.outstandingPrincipal(), opened.payout);
        assertGt(vault.totalShares(), 0);

        _repay(id);
        assertEq(vault.idle(), opened.navValue);
        uint256 sweeps;
        while (vault.totalShares() > 0 && vault.idle() > 0) {
            vm.prank(partner);
            vault.withdraw(1, partner);
            sweeps++;
            assertLt(sweeps, 1_000);
        }
        assertEq(vault.totalShares(), 0);
        assertEq(vault.idle(), opened.fee);
        uint256 feeLeft = vault.idle();
        vm.prank(partner);
        vault.withdraw(feeLeft, partner);
        assertEq(vault.idle(), 0);
        assertEq(vault.outstandingPrincipal(), 0);
        assertEq(usdg.balanceOf(address(vault)), 0);
        assertEq(usdg.balanceOf(partner), 1_000 + opened.fee);
        assertEq(usdg.balanceOf(platform), opened.payout);
    }

    function _repay(uint256 id) internal {
        uint256 owed = vault.owedOf(id);
        _mint(platform, owed);
        vm.prank(platform);
        vault.repay(id);
        assertEq(vault.owedOf(id), 0);
    }

    function _pay(uint256 id) internal {
        vm.prank(platform);
        vault.repay(id);
        assertEq(vault.owedOf(id), 0);
    }

    function _relay(uint256 id, bytes32 exitRef) internal {
        uint256 owed = vault.owedOf(id);
        vm.startPrank(platform);
        usdg.approve(address(router), owed);
        router.relayRepay(exitRef, 0);
        vm.stopPrank();
        assertEq(vault.owedOf(id), 0);
    }

    function _sweep() internal {
        uint256 idle = vault.idle();
        vm.prank(partner);
        vault.withdraw(idle, partner);
        assertEq(vault.idle(), 0);
    }
}
