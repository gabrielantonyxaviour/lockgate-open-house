// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AdvanceProposalLib} from "../../src/interfaces/AdvanceProposalLib.sol";
import {AdvanceProposal} from "../../src/interfaces/IAdvanceProposal.sol";
import {AdvanceStatus, RejectReason} from "../../src/partner/Types.sol";
import {PartnerVault} from "../../src/partner/PartnerVault.sol";
import {PartnerVaultAdmin} from "../../src/partner/PartnerVaultAdmin.sol";
import {ERC1271Signer} from "./mocks/ERC1271Signer.sol";
import {VaultFixture} from "./VaultFixture.sol";

contract AdvanceTest is VaultFixture {
    function setUp() public {
        _deploy();
        _openMandate();
        _deposit(1_000_000 * UNIT);
        _reserve(5_000 * UNIT);
    }

    function test_digestAndQuoteIdMatchViem() public pure {
        AdvanceProposal memory p = AdvanceProposal({
            platform: address(0xA1),
            recipient: address(0xA2),
            requestId: 7,
            navValue: 100_000e6,
            fee: 1_000e6,
            payout: 99_000e6,
            feeBps: 100,
            dueAt: 1_700_000_000,
            expiresAt: 1_690_000_000,
            nonce: 3,
            quoteId: bytes32(uint256(0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa))
        });
        assertEq(
            AdvanceProposalLib.digest(p, 31337, address(0xBEEF)),
            0x1a3fcca79eaf0386f59802c2b5b79c1a4c6335711b63e12c3afc9ba60dd9d2c3
        );
        assertEq(
            AdvanceProposalLib.quoteId(address(0xA1), 100_000e6, 1_000e6, 1_700_000_000, 50, 2000, 1_690_001_000, 1),
            0x5d2baa95fcb98c34735273acce48b8e68e79063aaa932a1685ce582e634b8b1b
        );
    }

    function test_fundRepayKeepsTheFeeInTheVault() public {
        AdvanceProposal memory p = _proposal(100_000 * UNIT, 1);
        uint256 id = _execute(p);
        assertEq(usdg.balanceOf(platform), p.payout);
        assertEq(usdg.balanceOf(lockgate), 0);
        assertEq(vault.idle(), 1_000_000 * UNIT - p.payout);
        assertEq(vault.outstandingPrincipal(), p.payout);
        assertEq(vault.exposureOf(platform), p.navValue);
        assertEq(vault.totalAssets(), 1_000_000 * UNIT);
        assertEq(vault.getAdvance(id).requestId, 1);
        assertEq(vault.getAdvance(id).exitRef, p.quoteId);
        _mint(platform, p.navValue);
        vm.prank(platform);
        vault.repay(id);
        assertEq(vault.outstandingPrincipal(), 0);
        assertEq(vault.totalAssets(), 1_000_000 * UNIT + p.fee);
        assertEq(vault.convertToAssets(vault.totalShares()), vault.totalAssets());
        assertEq(uint256(vault.getAdvance(id).status), uint256(AdvanceStatus.Repaid));
        assertEq(usdg.balanceOf(address(vault)), vault.idle() + vault.reserveCash());
        assertEq(usdg.balanceOf(lockgate), 0);
    }

    function test_deadlineAndNonceAndCancel() public {
        vm.warp(1_000_000);
        AdvanceProposal memory edge = _proposal(100_000 * UNIT, 2);
        edge.expiresAt = uint64(block.timestamp);
        assertEq(uint256(vault.preview(edge)), uint256(RejectReason.None));
        edge.expiresAt = uint64(block.timestamp - 1);
        assertEq(uint256(vault.preview(edge)), uint256(RejectReason.Deadline));
        AdvanceProposal memory p = _proposal(100_000 * UNIT, 3);
        _execute(p);
        bytes memory again = _engineSig(vault, p);
        vm.prank(partner);
        vm.expectRevert(PartnerVaultAdmin.NonceUsed.selector);
        vault.execute(p, again, "");
        AdvanceProposal memory cancelled = _proposal(100_000 * UNIT, 4);
        bytes memory cancelledSig = _engineSig(vault, cancelled);
        vm.prank(partner);
        vault.cancel(4);
        vm.prank(partner);
        vm.expectRevert(PartnerVaultAdmin.NonceUsed.selector);
        vault.execute(cancelled, cancelledSig, "");
    }

    function test_signatureIsBoundToVaultAndChain() public {
        AdvanceProposal memory p = _proposal(100_000 * UNIT, 5);
        bytes memory sig = _engineSig(vault, p);
        PartnerVault other = _proxy(partner);
        vm.startPrank(partner);
        other.setProposer(engine);
        other.setMandate(100, 30 days, 10_000, uint64(block.timestamp + 365 days));
        other.setPlatform(platform, true, 10_000_000 * UNIT, 0, false, 1 days);
        vm.stopPrank();
        _mint(partner, 1_000_000 * UNIT);
        vm.prank(partner);
        usdg.approve(address(other), type(uint256).max);
        vm.prank(partner);
        other.deposit(1_000_000 * UNIT);
        vm.prank(partner);
        vm.expectRevert(PartnerVaultAdmin.BadEngineSig.selector);
        other.execute(p, sig, "");
        vm.chainId(block.chainid + 1);
        vm.prank(partner);
        vm.expectRevert(PartnerVaultAdmin.BadEngineSig.selector);
        vault.execute(p, sig, "");
    }

    function test_submitThenApproveAndErc1271() public {
        AdvanceProposal memory filed = _proposal(100_000 * UNIT, 6);
        uint256 bal = usdg.balanceOf(address(vault));
        vault.submitProposal(filed, _engineSig(vault, filed));
        assertEq(usdg.balanceOf(address(vault)), bal);
        vm.prank(partner);
        vault.approve(filed);
        assertEq(uint256(vault.getAdvance(1).status), uint256(AdvanceStatus.Active));
        _reserve(10_000 * UNIT);
        ERC1271Signer signer = new ERC1271Signer();
        vm.prank(partner);
        vault.setPartnerSigner(address(signer));
        AdvanceProposal memory p = _proposal(50_000 * UNIT, 7);
        bytes memory engineSig = _engineSig(vault, p);
        vm.prank(lockgate);
        vm.expectRevert(PartnerVaultAdmin.NotApproved.selector);
        vault.execute(p, engineSig, hex"01");
        signer.allow(vault.hashTypedProposal(p));
        vm.prank(lockgate);
        vault.execute(p, engineSig, hex"01");
        assertEq(usdg.balanceOf(lockgate), 0);
        assertEq(vault.getAdvance(2).recipient, platform);
    }

    function test_pauseBlocksNewAdvancesAndRepayStillClears() public {
        uint256 id = _execute(_proposal(20_000 * UNIT, 8));
        vm.prank(partner);
        vault.setPaused(true);
        AdvanceProposal memory blocked = _proposal(20_000 * UNIT, 9);
        bytes memory blockedSig = _engineSig(vault, blocked);
        vm.prank(partner);
        vm.expectRevert(abi.encodeWithSelector(PartnerVaultAdmin.MandateRejected.selector, RejectReason.Paused));
        vault.execute(blocked, blockedSig, "");
        uint256 owed = vault.owedOf(id);
        _mint(platform, owed);
        vm.prank(platform);
        vault.repay(id);
        assertEq(uint256(vault.getAdvance(id).status), uint256(AdvanceStatus.Repaid));
    }

    function test_lateSlashThenWriteOffRemovesPrincipal() public {
        AdvanceProposal memory p = _proposal(100_000 * UNIT, 10);
        uint256 id = _execute(p);
        vm.warp(p.dueAt + vault.grace());
        vm.prank(lockgate);
        vault.markLate(id);
        assertEq(uint256(vault.getAdvance(id).status), uint256(AdvanceStatus.Late));
        uint256 lost = vault.getAdvance(id).principalRemaining;
        uint256 assets = vault.totalAssets();
        vm.prank(lockgate);
        vm.expectRevert(PartnerVaultAdmin.Unauthorized.selector);
        vault.writeOff(id);
        vm.prank(partner);
        vault.writeOff(id);
        assertEq(vault.totalAssets(), assets - lost);
        assertEq(uint256(vault.getAdvance(id).status), uint256(AdvanceStatus.WrittenOff));
        assertEq(usdg.balanceOf(lockgate), 0);
    }

    function test_withdrawCeilFavorsTheVault() public {
        usdg.mint(address(vault), 50_000 * UNIT);
        vm.prank(partner);
        vault.skim();
        uint256 supply = vault.totalShares();
        uint256 assets = vault.totalAssets();
        vm.prank(partner);
        uint256 burned = vault.withdraw(2, partner);
        assertGt(burned, (2 * supply) / assets);
    }
}
