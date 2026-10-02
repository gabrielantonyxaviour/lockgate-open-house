// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {AdvanceProposal} from "../../src/interfaces/IAdvanceProposal.sol";
import {AutoApproveModule} from "../../src/partner/AutoApproveModule.sol";
import {PartnerRouter} from "../../src/partner/PartnerRouter.sol";
import {PartnerVault} from "../../src/partner/PartnerVault.sol";
import {PartnerVaultAdmin} from "../../src/partner/PartnerVaultAdmin.sol";
import {AdvanceStatus, RejectReason} from "../../src/partner/Types.sol";
import {HeldToken, RouterProbe, ShortWord} from "./mocks/RevertProbes.sol";
import {VaultFixture} from "./VaultFixture.sol";

contract PartnerRevertsTest is VaultFixture {
    function setUp() public {
        _deploy();
        _openMandate();
        _deposit(1_000_000 * UNIT);
        _reserve(50_000 * UNIT);
    }

    function test_zeroAmountsZeroSharesAndBadSignatures() public {
        vm.startPrank(partner);
        vm.expectRevert(PartnerVaultAdmin.BadParam.selector);
        vault.deposit(0);
        vm.expectRevert(PartnerVaultAdmin.BadParam.selector);
        vault.withdraw(0, partner);
        vm.expectRevert(PartnerVaultAdmin.BadParam.selector);
        vault.withdraw(1, address(0));
        vm.expectRevert(PartnerVaultAdmin.ZeroAddress.selector);
        vault.transferOwnership(address(0));
        vm.stopPrank();
        vm.prank(platform);
        vm.expectRevert(PartnerVaultAdmin.BadParam.selector);
        vault.postReserve(platform, 0);

        usdg.mint(address(vault), 1_000_000 * UNIT);
        vm.prank(partner);
        vault.skim();
        _mint(partner, 1);
        uint256 idle = vault.idle();
        vm.prank(partner);
        vm.expectRevert(PartnerVaultAdmin.BadParam.selector);
        vault.deposit(1);
        assertEq(vault.idle(), idle);
        assertEq(vault.totalShares(), 1_000_000 * UNIT);

        AdvanceProposal memory unsigned = _proposal(10_000 * UNIT, 1);
        vm.prank(engine);
        vm.expectRevert(PartnerVaultAdmin.BadEngineSig.selector);
        vault.submitProposal(unsigned, "");
        vm.prank(partner);
        vault.cancel(2);
        vm.prank(engine);
        vm.expectRevert(PartnerVaultAdmin.NonceUsed.selector);
        vault.submitProposal(_proposal(10_000 * UNIT, 2), "");

        ShortWord missing = new ShortWord();
        PartnerVault bare = PartnerVault(
            address(
                new ERC1967Proxy(
                    address(new PartnerVault()),
                    abi.encodeCall(PartnerVaultAdmin.initialize, (partner, address(missing), 1 days, 1 days))
                )
            )
        );
        vm.prank(partner);
        vm.expectRevert(PartnerVaultAdmin.BalanceMismatch.selector);
        bare.skim();
    }

    function test_approveDeadlineAndClearedAdvanceReverts() public {
        vm.warp(1_000_000);
        AdvanceProposal memory open = _proposal(10_000 * UNIT, 3);
        vm.prank(partner);
        vm.expectRevert(PartnerVaultAdmin.NotSubmitted.selector);
        vault.approve(open);

        bytes memory openSig = _engineSig(vault, open);
        vm.prank(engine);
        vault.submitProposal(open, openSig);
        vm.prank(partner);
        vault.setPaused(true);
        vm.prank(partner);
        vm.expectRevert(abi.encodeWithSelector(PartnerVaultAdmin.MandateRejected.selector, RejectReason.Paused));
        vault.approve(open);
        vm.prank(partner);
        vault.setPaused(false);

        AdvanceProposal memory stale = _proposal(10_000 * UNIT, 4);
        stale.expiresAt = 0;
        bytes memory staleSig = _engineSig(vault, stale);
        vm.prank(partner);
        vm.expectRevert(abi.encodeWithSelector(PartnerVaultAdmin.MandateRejected.selector, RejectReason.Deadline));
        vault.execute(stale, staleSig, "");
        stale.expiresAt = 999_999;
        staleSig = _engineSig(vault, stale);
        vm.prank(partner);
        vm.expectRevert(abi.encodeWithSelector(PartnerVaultAdmin.MandateRejected.selector, RejectReason.Deadline));
        vault.execute(stale, staleSig, "");

        uint256 id = _execute(_proposal(10_000 * UNIT, 5));
        vm.prank(partner);
        vm.expectRevert(PartnerVaultAdmin.NonceUsed.selector);
        vault.cancel(5);
        AdvanceProposal memory spent = _proposal(10_000 * UNIT, 5);
        vm.prank(partner);
        vm.expectRevert(PartnerVaultAdmin.NonceUsed.selector);
        vault.approve(spent);
        vm.expectRevert(PartnerVaultAdmin.BadStatus.selector);
        vault.repay(0);
        vm.expectRevert(PartnerVaultAdmin.BadStatus.selector);
        vault.markLate(0);

        uint256 owed = vault.owedOf(id);
        usdg.mint(platform, owed);
        vm.startPrank(platform);
        usdg.approve(address(vault), owed);
        vault.repay(id);
        vm.expectRevert(PartnerVaultAdmin.BadStatus.selector);
        vault.markLate(id);
        vm.stopPrank();

        uint256 lateId = _execute(_proposal(100_000 * UNIT, 6));
        uint64 due = _proposal(100_000 * UNIT, 6).dueAt;
        vm.warp(uint256(due) + vault.grace());
        vault.markLate(lateId);
        vm.prank(partner);
        vault.writeOff(lateId);
        vm.expectRevert(PartnerVaultAdmin.BadStatus.selector);
        vault.repay(lateId);
        vm.expectRevert(PartnerVaultAdmin.BadStatus.selector);
        vault.markLate(lateId);
        assertEq(uint256(vault.getAdvance(lateId).status), uint256(AdvanceStatus.WrittenOff));
        assertEq(vault.advanceCount(), 2);
    }

    function test_adminBoundsAndRouterDirectory() public {
        PartnerVault impl = new PartnerVault();
        PartnerVault fresh = PartnerVault(address(new ERC1967Proxy(address(impl), "")));
        vm.expectRevert(PartnerVaultAdmin.ZeroAddress.selector);
        fresh.initialize(partner, address(0), 1 days, 1 days);
        assertEq(fresh.owner(), address(0));

        vm.startPrank(partner);
        vm.expectRevert(PartnerVaultAdmin.BadParam.selector);
        vault.setMandate(10_001, 30 days, 10_000, uint64(block.timestamp + 30 days));
        vm.expectRevert(PartnerVaultAdmin.BadParam.selector);
        vault.setMandate(100, 30 days, 10_001, uint64(block.timestamp + 30 days));
        vm.expectRevert(PartnerVaultAdmin.BadParam.selector);
        vault.setPlatform(address(0), true, 1, 0, false, 1);
        vm.expectRevert(PartnerVaultAdmin.BadParam.selector);
        vault.setPlatform(platform, true, 1, 10_001, false, 1);
        vm.expectRevert(PartnerVaultAdmin.BadParam.selector);
        vault.scheduleUpgrade(partner);
        vm.stopPrank();
        assertEq(vault.mandate().minFeeBps, 100);

        PartnerRouter router = new PartnerRouter();
        vm.expectRevert(PartnerRouter.UnknownRecord.selector);
        router.relayRepay(bytes32("none"), 0);
        vm.prank(partner);
        vm.expectRevert(PartnerRouter.UnknownVault.selector);
        router.remove(address(vault));
        vm.startPrank(partner);
        router.register(address(vault));
        vm.expectRevert(PartnerRouter.Registered.selector);
        router.register(address(vault));
        vm.stopPrank();
        assertEq(router.vaultCount(), 1);
    }

    function test_moduleRejectsEachBound() public {
        AutoApproveModule.Bounds memory bounds =
            AutoApproveModule.Bounds(1, 1, 0, 1 days, true, false, 0);
        vm.expectRevert(AutoApproveModule.ZeroAddress.selector);
        new AutoApproveModule(address(0), address(vault), bounds);
        vm.expectRevert(AutoApproveModule.ZeroAddress.selector);
        new AutoApproveModule(partner, address(0), bounds);

        AutoApproveModule module = new AutoApproveModule(
            partner,
            address(vault),
            AutoApproveModule.Bounds(1_000_000 * UNIT, 1_000_000 * UNIT, 100, 30 days, true, false, 500)
        );
        vm.startPrank(lockgate);
        vm.expectRevert(AutoApproveModule.Unauthorized.selector);
        module.acceptOwnership();
        vm.expectRevert(AutoApproveModule.Unauthorized.selector);
        module.setAllowlist(true);
        vm.expectRevert(AutoApproveModule.Unauthorized.selector);
        module.setPlatformAllowed(platform, true);
        vm.stopPrank();

        vm.startPrank(partner);
        vm.expectRevert(AutoApproveModule.BoundsExceeded.selector);
        module.setBounds(AutoApproveModule.Bounds(1, 1, 10_001, 1 days, true, false, 10_001));
        vm.expectRevert(AutoApproveModule.BoundsExceeded.selector);
        module.setBounds(AutoApproveModule.Bounds(1, 1, 200, 1 days, true, false, 100));
        vm.stopPrank();

        uint256 idle = vault.idle();
        AdvanceProposal memory zero = _proposal(10_000 * UNIT, 7);
        zero.navValue = 0;
        zero.fee = 0;
        zero.payout = 0;
        bytes memory zeroSig = _engineSig(vault, zero);
        vm.expectRevert(AutoApproveModule.BoundsExceeded.selector);
        module.execute(zero, zeroSig);

        AdvanceProposal memory wideBps = _proposal(10_000 * UNIT, 8);
        wideBps.feeBps = 501;
        bytes memory wideSig = _engineSig(vault, wideBps);
        vm.expectRevert(AutoApproveModule.BoundsExceeded.selector);
        module.execute(wideBps, wideSig);

        AdvanceProposal memory fat = _proposal(10_000 * UNIT, 9);
        fat.feeBps = 200;
        fat.fee = (fat.navValue * 500) / 10_000 + 1;
        fat.payout = fat.navValue - fat.fee;
        bytes memory fatSig = _engineSig(vault, fat);
        vm.expectRevert(AutoApproveModule.BoundsExceeded.selector);
        module.execute(fat, fatSig);

        AdvanceProposal memory due = _proposal(10_000 * UNIT, 10);
        due.dueAt = uint64(block.timestamp);
        bytes memory dueSig = _engineSig(vault, due);
        vm.expectRevert(AutoApproveModule.BoundsExceeded.selector);
        module.execute(due, dueSig);
        assertEq(vault.idle(), idle);
        assertEq(vault.advanceCount(), 0);

        AutoApproveModule huge = new AutoApproveModule(
            partner, address(vault), AutoApproveModule.Bounds(type(uint256).max, type(uint256).max, 0, 30 days, true, false, 0)
        );
        // ReentrancyGuard occupies slot 0, so `windowUsed` is slot 6.
        vm.store(address(huge), bytes32(uint256(6)), bytes32(uint256(1)));
        assertEq(huge.windowUsed(), 1);
        AdvanceProposal memory overflow = _proposal(1, 11);
        overflow.navValue = type(uint256).max;
        overflow.fee = 0;
        overflow.feeBps = 0;
        overflow.payout = 0;
        bytes memory overflowSig = _engineSig(vault, overflow);
        vm.expectRevert(AutoApproveModule.BoundsExceeded.selector);
        huge.execute(overflow, overflowSig);
    }

    function test_routerProbeRevertsTheNamedError() public {
        bytes32 exitRef = keccak256("probe");
        RouterProbe probe = new RouterProbe(address(this), platform, exitRef);
        PartnerRouter router = new PartnerRouter();
        router.register(address(probe));
        vm.prank(address(probe));
        router.notifyFunded(exitRef, 1, platform, 10, 1);
        vm.expectRevert(PartnerRouter.UnknownRecord.selector);
        router.relayRepay(exitRef, 1);

        probe.setFailOwed(true);
        vm.expectRevert(PartnerRouter.Mismatch.selector);
        router.relayRepay(exitRef, 0);
        probe.setFailOwed(false);
        probe.setFailAsset(true);
        vm.expectRevert(PartnerRouter.Mismatch.selector);
        router.relayRepay(exitRef, 0);
        probe.setFailAsset(false);
        probe.setAsset(address(1));
        vm.expectRevert(PartnerRouter.BalanceMismatch.selector);
        router.relayRepay(exitRef, 0);

        HeldToken token = new HeldToken();
        probe.setAsset(address(token));
        token.mint(address(this), 5);
        vm.expectRevert(PartnerRouter.BalanceMismatch.selector);
        router.relayRepay(exitRef, 0);
        assertEq(token.balanceOf(address(this)), 5);
        assertEq(token.balanceOf(address(router)), 0);
        assertEq(router.recordsOf(exitRef).length, 1);
    }
}
