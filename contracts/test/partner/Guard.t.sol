// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {AdvanceProposal} from "../../src/interfaces/IAdvanceProposal.sol";
import {AutoApproveModule} from "../../src/partner/AutoApproveModule.sol";
import {PartnerVault} from "../../src/partner/PartnerVault.sol";
import {PartnerVaultAdmin} from "../../src/partner/PartnerVaultAdmin.sol";
import {PartnerVaultV2} from "./PartnerVaultV2.sol";
import {ReenterPlatform} from "./mocks/ReenterPlatform.sol";
import {VaultFixture} from "./VaultFixture.sol";

contract GuardTest is VaultFixture {
    function setUp() public {
        _deploy();
        _openMandate();
        _deposit(1_000_000 * UNIT);
        _reserve(50_000 * UNIT);
    }

    function test_reentrancyPaysOnce() public {
        ReenterPlatform sink = new ReenterPlatform();
        sink.arm(address(vault));
        usdg.setHook(address(sink));
        vm.prank(partner);
        vault.setPlatform(address(sink), true, 10_000_000 * UNIT, 0, false, 1 days);
        AdvanceProposal memory p = _proposal(100_000 * UNIT, 1);
        p.platform = address(sink);
        p.recipient = address(sink);
        bytes memory sig = _engineSig(vault, p);
        vm.prank(partner);
        vault.execute(p, sig, "");
        assertFalse(sink.withdrew());
        assertFalse(sink.executed());
        assertEq(sink.withdrawSel(), ReentrancyGuard.ReentrancyGuardReentrantCall.selector);
        assertEq(sink.executeSel(), ReentrancyGuard.ReentrancyGuardReentrantCall.selector);
        assertEq(usdg.balanceOf(address(sink)), p.payout);
        assertEq(vault.advanceCount(), 1);
    }

    function test_partnerTimelockedUpgrade() public {
        PartnerVaultV2 next = new PartnerVaultV2();
        vm.prank(lockgate);
        vm.expectRevert(PartnerVaultAdmin.Unauthorized.selector);
        vault.scheduleUpgrade(address(next));
        vm.prank(partner);
        vm.expectRevert(PartnerVaultAdmin.BadParam.selector);
        vault.increaseUpgradeDelay(1 days);
        vm.prank(partner);
        vault.scheduleUpgrade(address(next));
        vm.prank(partner);
        vm.expectRevert(PartnerVaultAdmin.TooEarly.selector);
        vault.executeUpgrade();
        vm.warp(vault.scheduledEta());
        uint256 idleBefore = vault.idle();
        vm.prank(partner);
        vault.executeUpgrade();
        assertEq(PartnerVaultV2(address(vault)).vaultVersion(), 2);
        assertEq(vault.idle(), idleBefore);
        assertEq(vault.owner(), partner);
        assertEq(usdg.balanceOf(address(vault)), idleBefore + vault.reserveCash());
    }

    function test_autoModuleCannotExceedPartnerBounds() public {
        AutoApproveModule module = new AutoApproveModule(
            partner,
            address(vault),
            AutoApproveModule.Bounds({
                maxNavValue: 50_000 * UNIT,
                dailyLimit: 60_000 * UNIT,
                minFeeBps: 100,
                maxTenor: 30 days,
                enabled: true,
                allowlistEnabled: false
            })
        );
        vm.prank(partner);
        vault.setAutoModule(address(module));
        vm.prank(lockgate);
        vm.expectRevert(AutoApproveModule.Unauthorized.selector);
        module.setBounds(AutoApproveModule.Bounds(1, 1, 1, 1, true, false));
        vm.prank(address(module));
        vm.expectRevert(PartnerVaultAdmin.Unauthorized.selector);
        vault.withdraw(1, lockgate);
        AdvanceProposal memory tooBig = _proposal(80_000 * UNIT, 2);
        bytes memory tooBigSig = _engineSig(vault, tooBig);
        vm.prank(lockgate);
        vm.expectRevert(AutoApproveModule.BoundsExceeded.selector);
        module.execute(tooBig, tooBigSig);
        AdvanceProposal memory cheap = _proposal(10_000 * UNIT, 3);
        cheap.fee = (cheap.navValue * 100) / 10_000 - 1;
        cheap.payout = cheap.navValue - cheap.fee;
        bytes memory cheapSig = _engineSig(vault, cheap);
        vm.prank(lockgate);
        vm.expectRevert(AutoApproveModule.BoundsExceeded.selector);
        module.execute(cheap, cheapSig);
        AdvanceProposal memory slow = _proposal(10_000 * UNIT, 4);
        bytes memory slowSig = _engineSig(vault, slow);
        vm.prank(partner);
        module.setBounds(AutoApproveModule.Bounds(50_000 * UNIT, 60_000 * UNIT, 100, 1 days, true, false));
        vm.prank(lockgate);
        vm.expectRevert(AutoApproveModule.BoundsExceeded.selector);
        module.execute(slow, slowSig);
        vm.prank(partner);
        module.setBounds(AutoApproveModule.Bounds(50_000 * UNIT, 60_000 * UNIT, 100, 30 days, true, false));
        AdvanceProposal memory first = _proposal(40_000 * UNIT, 5);
        bytes memory firstSig = _engineSig(vault, first);
        vm.prank(lockgate);
        module.execute(first, firstSig);
        assertEq(usdg.balanceOf(address(module)) + usdg.balanceOf(lockgate), 0);
        assertEq(vault.getAdvance(1).recipient, platform);
        AdvanceProposal memory second = _proposal(40_000 * UNIT, 6);
        bytes memory secondSig = _engineSig(vault, second);
        vm.prank(lockgate);
        vm.expectRevert(AutoApproveModule.BoundsExceeded.selector);
        module.execute(second, secondSig);
        vm.prank(partner);
        module.setBounds(AutoApproveModule.Bounds(50_000 * UNIT, 60_000 * UNIT, 100, 30 days, false, false));
        vm.prank(lockgate);
        vm.expectRevert(AutoApproveModule.Disabled.selector);
        module.execute(second, secondSig);
    }
}
