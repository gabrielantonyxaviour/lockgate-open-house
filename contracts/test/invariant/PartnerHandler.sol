// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {MockUSDG} from "../../src/core/MockUSDG.sol";
import {AdvanceProposal} from "../../src/interfaces/IAdvanceProposal.sol";
import {PartnerRouter} from "../../src/partner/PartnerRouter.sol";
import {PartnerVault} from "../../src/partner/PartnerVault.sol";
import {PartnerVaultAdmin} from "../../src/partner/PartnerVaultAdmin.sol";

/// @notice Partner funds and repays. Lockgate only signs. Calls that would pay Lockgate must revert.
contract PartnerHandler is Test {
    uint256 internal constant U = 1e6;

    MockUSDG public token;
    PartnerVault public vault;
    PartnerRouter public router;
    address public partner;
    address public platform;
    address public lockgate;
    address public stranger;
    uint256 public paidOut;
    uint256 public breached;
    uint256 internal lockgateKey;
    uint256 internal nextNonce = 1;

    constructor() {
        partner = makeAddr("partner");
        platform = makeAddr("platform");
        stranger = makeAddr("stranger");
        (lockgate, lockgateKey) = makeAddrAndKey("lockgate");
        token = new MockUSDG(address(this));
        PartnerVault impl = new PartnerVault();
        bytes memory init = abi.encodeCall(PartnerVaultAdmin.initialize, (partner, address(token), 1 days, 1 days));
        vault = PartnerVault(address(new ERC1967Proxy(address(impl), init)));
        router = new PartnerRouter();

        token.mint(partner, 500_000 * U);
        vm.startPrank(partner);
        vault.setProposer(lockgate);
        vault.setMandate(25, 30 days, 10_000, uint64(block.timestamp + 365 days));
        vault.setPlatform(platform, true, 10_000_000 * U, 0, false, 7 days);
        vault.setRouter(address(router));
        token.approve(address(vault), type(uint256).max);
        vault.deposit(500_000 * U);
        router.register(address(vault));
        vm.stopPrank();
    }

    function fund(uint256 navSeed, uint16 bpsSeed) external {
        uint256 nav = bound(navSeed, 1_000 * U, 8_000 * U);
        uint256 bps = bound(bpsSeed, 25, 400);
        uint256 beforeCount = vault.advanceCount();
        if (_execute(_proposal(nav, (nav * bps) / 10_000, platform))) {
            if (vault.advanceCount() != beforeCount + 1) breached += 1;
            paidOut += nav - (nav * bps) / 10_000;
        }
        if (token.balanceOf(lockgate) != 0) breached += 1;
    }

    function repay(uint256 idSeed) external {
        uint256 n = vault.advanceCount();
        if (n == 0) return;
        uint256 id = bound(idSeed, 1, n);
        uint256 owed = vault.owedOf(id);
        if (owed == 0) return;
        token.mint(platform, owed);
        vm.startPrank(platform);
        token.approve(address(router), owed);
        try router.relayRepay(vault.getAdvance(id).exitRef, 0) {} catch {}
        vm.stopPrank();
        if (token.balanceOf(address(router)) != 0 || token.balanceOf(lockgate) != 0) breached += 1;
    }

    function partnerWithdraw(uint256 amountSeed) external {
        uint256 idle = vault.idle();
        if (idle < 2) return;
        uint256 amount = bound(amountSeed, 1, idle / 2);
        vm.prank(partner);
        try vault.withdraw(amount, partner) returns (uint256) {} catch {}
        if (token.balanceOf(lockgate) != 0) breached += 1;
    }

    function lockgatePull(uint256 amountSeed, uint8 kind) external {
        uint256 idleBefore = vault.idle();
        uint256 countBefore = vault.advanceCount();
        uint256 amount = bound(amountSeed, 1, 1_000 * U);
        vm.startPrank(lockgate);
        if (kind % 6 == 0) {
            try vault.withdraw(amount, lockgate) returns (uint256) {
                breached += 1;
            } catch {}
        } else if (kind % 6 == 1) {
            try vault.withdrawReserve(platform, amount, lockgate) {
                breached += 1;
            } catch {}
        } else if (kind % 6 == 2) {
            try vault.skim() returns (uint256) {
                breached += 1;
            } catch {}
        } else if (kind % 6 == 3) {
            try vault.setMandate(1, 1 days, 1, uint64(block.timestamp + 1 days)) {
                breached += 1;
            } catch {}
        } else if (kind % 6 == 4) {
            try vault.setPaused(true) {
                breached += 1;
            } catch {}
        } else {
            try vault.executeUpgrade() {
                breached += 1;
            } catch {}
        }
        vm.stopPrank();
        if (vault.idle() != idleBefore || vault.advanceCount() != countBefore) breached += 1;
        if (token.balanceOf(lockgate) != 0) breached += 1;
    }

    function fundOutsider(uint256 navSeed) external {
        uint256 nav = bound(navSeed, 1_000 * U, 4_000 * U);
        uint256 beforeCount = vault.advanceCount();
        uint256 strangerBefore = token.balanceOf(stranger);
        if (_execute(_proposal(nav, (nav * 100) / 10_000, stranger))) breached += 1;
        if (vault.advanceCount() != beforeCount || token.balanceOf(stranger) != strangerBefore) breached += 1;
        if (token.balanceOf(lockgate) != 0) breached += 1;
    }

    function fundLockgateAsRecipient(uint256 navSeed) external {
        uint256 nav = bound(navSeed, 1_000 * U, 4_000 * U);
        AdvanceProposal memory proposal = _proposal(nav, (nav * 100) / 10_000, platform);
        proposal.recipient = lockgate;
        uint256 beforeCount = vault.advanceCount();
        if (_execute(proposal)) breached += 1;
        if (vault.advanceCount() != beforeCount || token.balanceOf(lockgate) != 0) breached += 1;
    }

    function skimDonation(uint256 amountSeed) external {
        uint256 gift = bound(amountSeed, 1, 5_000 * U);
        token.mint(address(vault), gift);
        uint256 lockBefore = token.balanceOf(lockgate);
        vm.prank(lockgate);
        try vault.skim() returns (uint256) {
            breached += 1;
        } catch {}
        if (token.balanceOf(lockgate) != lockBefore) breached += 1;
        vm.prank(partner);
        try vault.skim() returns (uint256 extra) {
            if (extra != gift) breached += 1;
        } catch {
            breached += 1;
        }
        if (token.balanceOf(lockgate) != 0) breached += 1;
    }

    function _proposal(uint256 nav, uint256 fee, address recipient) internal returns (AdvanceProposal memory proposal) {
        proposal = AdvanceProposal({
            platform: recipient,
            recipient: recipient,
            requestId: nextNonce,
            navValue: nav,
            fee: fee,
            payout: nav - fee,
            feeBps: 100,
            dueAt: uint64(block.timestamp + 1 days),
            expiresAt: uint64(block.timestamp + 1 hours),
            nonce: nextNonce,
            quoteId: keccak256(abi.encode("quote", nextNonce))
        });
        nextNonce += 1;
    }

    function _execute(AdvanceProposal memory proposal) internal returns (bool ok) {
        bytes memory sig = _sign(proposal);
        vm.prank(partner);
        try vault.execute(proposal, sig, "") returns (uint256) {
            ok = true;
        } catch {
            ok = false;
        }
    }

    function _sign(AdvanceProposal memory proposal) internal view returns (bytes memory) {
        bytes32 digest = vault.hashTypedProposal(proposal);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(lockgateKey, digest);
        return abi.encodePacked(r, s, v);
    }
}
