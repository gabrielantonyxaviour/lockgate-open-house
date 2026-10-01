// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {AdvanceProposal} from "../../src/interfaces/IAdvanceProposal.sol";
import {IPartnerVault} from "../../src/partner/interfaces/IPartnerVault.sol";
import {AutoApproveModule} from "../../src/partner/AutoApproveModule.sol";
import {PartnerVault} from "../../src/partner/PartnerVault.sol";
import {PartnerVaultAdmin} from "../../src/partner/PartnerVaultAdmin.sol";
import {AdvanceStatus, RejectReason} from "../../src/partner/Types.sol";
import {PartnerVaultV2} from "./PartnerVaultV2.sol";
import {FeeUSDG} from "./mocks/FeeUSDG.sol";
import {VaultFixture} from "./VaultFixture.sol";

contract PartnerFailuresTest is VaultFixture {
    function setUp() public {
        _deploy();
        _openMandate();
        _deposit(1_000_000 * UNIT);
        _reserve(50_000 * UNIT);
    }

    function test_secondSubmitAndMismatchedExecute() public {
        AdvanceProposal memory filed = _proposal(100_000 * UNIT, 1);
        bytes memory sig = _engineSig(vault, filed);
        vm.prank(engine);
        bytes32 digest = IPartnerVault(address(vault)).submitProposal(filed, sig);
        assertEq(digest, vault.hashTypedProposal(filed));
        vm.prank(engine);
        vm.expectRevert(PartnerVaultAdmin.NonceUsed.selector);
        vault.submitProposal(filed, sig);

        AdvanceProposal memory other = _proposal(100_000 * UNIT, 1);
        other.fee = filed.fee + 1;
        other.payout = other.navValue - other.fee;
        bytes memory otherSig = _engineSig(vault, other);
        vm.prank(partner);
        vm.expectRevert(PartnerVaultAdmin.NotSubmitted.selector);
        vault.execute(other, otherSig, "");
    }

    function test_zeroExpiryAndZeroConcentrationBlock() public {
        AdvanceProposal memory p = _proposal(100_000 * UNIT, 2);
        vm.prank(partner);
        vault.setMandate(100, 30 days, 0, uint64(block.timestamp + 365 days));
        assertEq(uint256(vault.preview(p)), uint256(RejectReason.Concentration));
        vm.prank(partner);
        vault.setMandate(100, 30 days, 10_000, 0);
        assertEq(uint256(vault.preview(p)), uint256(RejectReason.MandateExpired));
    }

    function test_payoutDeskIsTheOnlyRecipient() public {
        address desk = makeAddr("desk");
        vm.prank(partner);
        vault.setPayout(platform, desk);
        AdvanceProposal memory p = _proposal(100_000 * UNIT, 3);
        assertEq(uint256(vault.preview(p)), uint256(RejectReason.Recipient));
        p.recipient = desk;
        uint256 id = _execute(p);
        assertEq(vault.getAdvance(id).recipient, desk);
        assertEq(usdg.balanceOf(desk), p.payout);
        assertEq(usdg.balanceOf(lockgate), 0);
    }

    function test_earlyMarkLateThenWriteOff() public {
        AdvanceProposal memory p = _proposal(100_000 * UNIT, 4);
        uint256 id = _execute(p);
        vm.prank(partner);
        vm.expectRevert(PartnerVaultAdmin.BadStatus.selector);
        vault.writeOff(id);
        vm.warp(p.dueAt);
        vm.expectRevert(PartnerVaultAdmin.TooEarly.selector);
        vault.markLate(id);
        vm.warp(uint256(p.dueAt) + vault.grace());
        vault.markLate(id);
        assertEq(uint256(vault.getAdvance(id).status), uint256(AdvanceStatus.Late));
        vm.prank(partner);
        vault.writeOff(id);
        vm.prank(partner);
        vm.expectRevert(PartnerVaultAdmin.BadStatus.selector);
        vault.writeOff(id);
    }

    function test_secondRepayReverts() public {
        AdvanceProposal memory live = _proposal(50_000 * UNIT, 5);
        uint256 liveId = _execute(live);
        uint256 owed = vault.owedOf(liveId);
        usdg.mint(platform, owed);
        vm.startPrank(platform);
        usdg.approve(address(vault), owed);
        vault.repay(liveId);
        vm.expectRevert(PartnerVaultAdmin.BadStatus.selector);
        vault.repay(liveId);
        vm.stopPrank();
    }

    function test_feeOnTransferDepositReverts() public {
        FeeUSDG fee = new FeeUSDG();
        PartnerVault v = PartnerVault(
            address(
                new ERC1967Proxy(
                    address(new PartnerVault()),
                    abi.encodeCall(PartnerVaultAdmin.initialize, (partner, address(fee), 1 days, 1 days))
                )
            )
        );
        fee.mint(partner, 1_000 * UNIT);
        vm.startPrank(partner);
        fee.approve(address(v), 1_000 * UNIT);
        vm.expectRevert(PartnerVaultAdmin.BalanceMismatch.selector);
        v.deposit(1_000 * UNIT);
        vm.stopPrank();
    }

    function test_autoModuleAllowlistAndDailyWindow() public {
        AutoApproveModule module = new AutoApproveModule(
            partner,
            address(vault),
            AutoApproveModule.Bounds({
                maxNavValue: 200_000 * UNIT,
                dailyLimit: 150_000 * UNIT,
                minFeeBps: 100,
                maxFeeBps: 100,
                maxTenor: 30 days,
                enabled: true,
                allowlistEnabled: true
            })
        );
        vm.prank(partner);
        vault.setAutoModule(address(module));
        AdvanceProposal memory first = _proposal(100_000 * UNIT, 8);
        bytes memory sig = _engineSig(vault, first);
        vm.expectRevert(AutoApproveModule.BoundsExceeded.selector);
        module.execute(first, sig);
        vm.prank(partner);
        module.setPlatformAllowed(platform, true);
        module.execute(first, sig);

        AdvanceProposal memory second = _proposal(100_000 * UNIT, 9);
        bytes memory secondSig = _engineSig(vault, second);
        vm.expectRevert(AutoApproveModule.BoundsExceeded.selector);
        module.execute(second, secondSig);
        vm.warp(block.timestamp + 1 days);
        AdvanceProposal memory renewed = _proposal(100_000 * UNIT, 9);
        bytes memory renewedSig = _engineSig(vault, renewed);
        module.execute(renewed, renewedSig);

        vm.prank(partner);
        module.setBounds(
            AutoApproveModule.Bounds({
                maxNavValue: 200_000 * UNIT,
                dailyLimit: 150_000 * UNIT,
                minFeeBps: 100,
                maxFeeBps: 100,
                maxTenor: 30 days,
                enabled: false,
                allowlistEnabled: true
            })
        );
        AdvanceProposal memory third = _proposal(100_000 * UNIT, 10);
        bytes memory thirdSig = _engineSig(vault, third);
        vm.expectRevert(AutoApproveModule.Disabled.selector);
        module.execute(third, thirdSig);
    }

    function test_upgradeTimelockCancelAndDelay() public {
        PartnerVaultV2 next = new PartnerVaultV2();
        vm.startPrank(partner);
        vault.scheduleUpgrade(address(next));
        uint256 eta = vault.scheduledEta();
        vm.warp(eta - 1);
        vm.expectRevert(PartnerVaultAdmin.TooEarly.selector);
        vault.executeUpgrade();
        vault.cancelUpgrade();
        assertEq(vault.scheduledImpl(), address(0));
        vm.expectRevert(PartnerVaultAdmin.UpgradeNotScheduled.selector);
        vault.executeUpgrade();
        vm.expectRevert(PartnerVaultAdmin.BadParam.selector);
        vault.increaseUpgradeDelay(1 days);
        vault.increaseUpgradeDelay(2 days);
        vault.scheduleUpgrade(address(next));
        eta = vault.scheduledEta();
        vm.stopPrank();
        vm.warp(eta - 1);
        vm.prank(partner);
        vm.expectRevert(PartnerVaultAdmin.TooEarly.selector);
        vault.executeUpgrade();
        vm.warp(eta);
        vm.prank(partner);
        vault.executeUpgrade();
        assertEq(vault.vaultVersion(), 2);
    }

    function test_twoStepOwnershipMovesTheShares() public {
        address next = makeAddr("nextDesk");
        uint256 shares = vault.totalShares();
        vm.prank(partner);
        vault.transferOwnership(next);
        assertEq(vault.owner(), partner);
        assertEq(vault.sharesOf(partner), shares);
        vm.prank(lockgate);
        vm.expectRevert(PartnerVaultAdmin.Unauthorized.selector);
        vault.acceptOwnership();
        vm.prank(next);
        vault.acceptOwnership();
        assertEq(vault.owner(), next);
        assertEq(vault.sharesOf(next), shares);
        assertEq(vault.sharesOf(partner), 0);
        uint256 idle = vault.idle();
        vm.prank(next);
        vault.withdraw(idle, next);
        assertEq(usdg.balanceOf(next), idle);
        assertEq(usdg.balanceOf(lockgate), 0);
    }
}
