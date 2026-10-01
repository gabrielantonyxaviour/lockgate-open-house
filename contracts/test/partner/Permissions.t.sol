// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AdvanceProposal} from "../../src/interfaces/IAdvanceProposal.sol";
import {RejectReason} from "../../src/partner/Types.sol";
import {PartnerVault} from "../../src/partner/PartnerVault.sol";
import {PartnerVaultAdmin} from "../../src/partner/PartnerVaultAdmin.sol";
import {VaultFixture} from "./VaultFixture.sol";

contract PermissionsTest is VaultFixture {
    function setUp() public {
        _deploy();
        _openMandate();
        _deposit(1_000_000 * UNIT);
        _reserve(50_000 * UNIT);
    }

    function test_lockgateCannotAdministerOrWithdraw() public {
        vm.startPrank(lockgate);
        _unauth();
        vault.deposit(1);
        _unauth();
        vault.withdraw(1, lockgate);
        _unauth();
        vault.skim();
        _unauth();
        vault.setProposer(lockgate);
        _unauth();
        vault.setPartnerSigner(lockgate);
        _unauth();
        vault.setAutoModule(lockgate);
        _unauth();
        vault.setRouter(lockgate);
        _unauth();
        vault.setOracle(lockgate, 1, 1);
        _unauth();
        vault.setGrace(0);
        _unauth();
        vault.setPaused(true);
        _unauth();
        vault.setMandate(0, 1, 1, 1);
        _unauth();
        vault.setPlatform(platform, false, 0, 0, false, 0);
        _unauth();
        vault.setPayout(platform, lockgate);
        _unauth();
        vault.scheduleUpgrade(address(vault));
        _unauth();
        vault.cancelUpgrade();
        _unauth();
        vault.increaseUpgradeDelay(2 days);
        _unauth();
        vault.transferOwnership(lockgate);
        _unauth();
        vault.acceptOwnership();
        _unauth();
        vault.cancel(1);
        _unauth();
        vault.writeOff(1);
        _unauth();
        vault.executeUpgrade();
        _unauth();
        vault.upgradeToAndCall(address(vault), "");
        _unauth();
        vault.withdrawReserve(platform, 1, lockgate);
        vm.stopPrank();
        assertEq(vault.owner(), partner);
        assertEq(vault.paused(), false);
        assertEq(usdg.balanceOf(lockgate), 0);
    }

    function test_engineSignatureAloneDoesNotPay() public {
        AdvanceProposal memory p = _proposal(100_000 * UNIT, 1);
        uint256 idleBefore = vault.idle();
        uint256 balBefore = usdg.balanceOf(address(vault));
        bytes memory sig = _engineSig(vault, p);
        vm.prank(lockgate);
        vault.submitProposal(p, sig);
        assertEq(vault.idle(), idleBefore);
        assertEq(usdg.balanceOf(address(vault)), balBefore);
        assertFalse(vault.nonceUsed(1));
        vm.prank(lockgate);
        vm.expectRevert(PartnerVaultAdmin.NotApproved.selector);
        vault.execute(p, sig, "");
        assertEq(vault.idle(), idleBefore);
        assertEq(usdg.balanceOf(lockgate), 0);
    }

    function test_lockgateAsRecipientIsRejected() public {
        AdvanceProposal memory p = _proposal(100_000 * UNIT, 2);
        p.recipient = lockgate;
        assertEq(uint256(vault.preview(p)), uint256(RejectReason.Recipient));
        bytes memory sig = _engineSig(vault, p);
        vm.prank(partner);
        vm.expectRevert(abi.encodeWithSelector(PartnerVaultAdmin.MandateRejected.selector, RejectReason.Recipient));
        vault.execute(p, sig, "");
        assertEq(usdg.balanceOf(lockgate), 0);
    }

    function test_markLateDoesNotPayTheCaller() public {
        uint256 id = _execute(_proposal(100_000 * UNIT, 3));
        uint256 lockBal = usdg.balanceOf(lockgate);
        uint256 vaultBal = usdg.balanceOf(address(vault));
        vm.warp(_proposal(100_000 * UNIT, 3).dueAt + vault.grace());
        vm.prank(lockgate);
        vault.markLate(id);
        assertEq(usdg.balanceOf(lockgate), lockBal);
        assertEq(usdg.balanceOf(address(vault)), vaultBal);
        assertGt(vault.getAdvance(id).owed, 0);
    }

    function _unauth() internal {
        vm.expectRevert(PartnerVaultAdmin.Unauthorized.selector);
    }
}
