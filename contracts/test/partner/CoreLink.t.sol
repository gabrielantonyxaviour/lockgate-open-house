// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AdvanceProposal} from "../../src/interfaces/IAdvanceProposal.sol";
import {IAdvanceProposal} from "../../src/interfaces/IAdvanceProposal.sol";
import {AdvanceProposalLib} from "../../src/interfaces/AdvanceProposalLib.sol";
import {ILockgateCreditLine} from "../../src/interfaces/ILockgateCreditLine.sol";
import {CreditLineBook} from "../../src/facility/CreditLineBook.sol";
import {IReceivablesBook} from "../../src/facility/interfaces/IReceivablesBook.sol";
import {IPartnerVault} from "../../src/partner/interfaces/IPartnerVault.sol";
import {PartnerVault} from "../../src/partner/PartnerVault.sol";
import {PartnerVaultAdmin} from "../../src/partner/PartnerVaultAdmin.sol";
import {PartnerVaultRead} from "../../src/partner/PartnerVaultRead.sol";
import {RejectReason} from "../../src/partner/Types.sol";
import {CoreStack} from "./CoreStack.sol";

/// @notice Partner vault against the live stage-1 interfaces. The token is G6's MockUSDG.
contract PartnerCoreLinkTest is CoreStack {
    uint256 internal constant ENGINE_PK = 0xA11CE;
    uint256 internal constant LINE_NAV = 10_000 * UNIT;
    uint256 internal constant VAULT_NAV = 4_000 * UNIT;
    bytes4 internal constant PAYOUT_TO = 0x63aec9af;

    PartnerVault internal vault;
    address internal partner;
    address internal platform;
    address internal engine;

    function setUp() public {
        _core(500);
        _armSource(500 * UNIT);
        engine = vm.addr(ENGINE_PK);
        partner = vm.addr(0xB0B);
        platform = makeAddr("platform");
        vault = _vault(partner);
        vm.startPrank(partner);
        vault.setProposer(engine);
        vault.setMandate(100, 30 days, 10_000, uint64(block.timestamp + 365 days));
        vault.setPlatform(platform, true, 10_000_000 * UNIT, 500, false, 1 days);
        vm.stopPrank();
        _fundVault(vault, partner, 50_000 * UNIT);
        token.mint(platform, 1_000 * UNIT);
        vm.startPrank(platform);
        token.approve(address(vault), 1_000 * UNIT);
        vault.postReserve(platform, 1_000 * UNIT);
        vm.stopPrank();
    }

    function test_sharedSelectorsMatch() public pure {
        assertEq(bytes32(IPartnerVault.submitProposal.selector), bytes32(IAdvanceProposal.submitProposal.selector));
        assertEq(bytes32(IPartnerVault.repay.selector), bytes32(ILockgateCreditLine.repay.selector));
        assertEq(bytes32(IPartnerVault.markLate.selector), bytes32(ILockgateCreditLine.markLate.selector));
        assertEq(bytes32(IPartnerVault.graceOf.selector), bytes32(ILockgateCreditLine.graceOf.selector));
        assertEq(
            bytes32(IReceivablesBook.eligibleOutstanding.selector), bytes32(ILockgateCreditLine.eligibleOutstanding.selector)
        );
        assertEq(bytes32(IReceivablesBook.lateOutstanding.selector), bytes32(ILockgateCreditLine.lateOutstanding.selector));
        assertEq(IPartnerVault.payoutTo.selector, PartnerVaultRead.payoutTo.selector);
        assertEq(IPartnerVault.payoutTo.selector, PAYOUT_TO);
    }

    function test_stage1QuoteDoesNotSpendTheVault() public view {
        uint256 idle = vault.idle();
        uint256 lineCash = token.balanceOf(address(line));
        (uint256 quoted, uint16 bps, bool available, string memory reason) = line.quote(address(source), LINE_NAV);
        assertTrue(available, reason);
        assertEq(bps, 99);
        assertEq(quoted, 99 * UNIT);

        AdvanceProposal memory cheap = _proposal(LINE_NAV, quoted, bps, 1);
        assertEq(uint256(vault.preview(cheap)), uint256(RejectReason.Fee));
        assertEq(vault.idle(), idle);
        assertEq(vault.payoutTo(platform), address(0));
        assertEq(token.balanceOf(address(line)), lineCash);
        assertEq(token.balanceOf(address(vault)), idle + vault.reserveCash());
    }

    function test_g6SubmitAndPartnerExecuteStayOffTheCreditLine() public {
        source.refresh();
        (uint256 lineId,) = source.draw(LINE_NAV);
        CreditLineBook book = new CreditLineBook(address(line));
        assertEq(book.eligibleOutstanding(), line.eligibleOutstanding());
        assertEq(book.lateOutstanding(), 0);
        assertEq(book.eligibleOutstanding(), LINE_NAV);

        uint256 fee = (VAULT_NAV * 100) / 10_000;
        AdvanceProposal memory p = _proposal(VAULT_NAV, fee, 100, 2);
        bytes memory sig = _sig(p);
        bytes32 expected = AdvanceProposalLib.digest(p, block.chainid, address(vault));
        assertEq(vault.hashTypedProposal(p), expected);

        uint256 vaultBefore = token.balanceOf(address(vault));
        uint256 lineBefore = line.eligibleOutstanding();
        uint256 capitalBefore = line.capital();
        IAdvanceProposal(address(vault)).submitProposal(p, sig);
        assertEq(vault.proposalHashOf(p.nonce), expected);
        assertEq(token.balanceOf(address(vault)), vaultBefore);

        vm.prank(partner);
        uint256 id = vault.execute(p, sig, "");
        assertEq(vault.owedOf(id), VAULT_NAV);
        assertEq(vault.exposureOf(platform), VAULT_NAV);
        assertEq(token.balanceOf(platform), VAULT_NAV - fee);
        assertEq(line.eligibleOutstanding(), lineBefore);
        assertEq(line.capital(), capitalBefore);
        assertEq(line.remainingOf(lineId), LINE_NAV);
        assertEq(vault.idle(), 50_000 * UNIT - (VAULT_NAV - fee));
    }

    function test_bookOnAVaultReverts() public {
        uint256 bal = token.balanceOf(address(vault));
        CreditLineBook book = new CreditLineBook(address(vault));
        vm.expectRevert();
        book.eligibleOutstanding();
        vm.expectRevert();
        book.lateOutstanding();
        assertEq(token.balanceOf(address(vault)), bal);
    }

    function _proposal(uint256 nav, uint256 fee, uint16 bps, uint256 nonce)
        internal
        view
        returns (AdvanceProposal memory p)
    {
        uint64 dueAt = uint64(block.timestamp + 7 days);
        p = AdvanceProposal({
            platform: platform,
            recipient: platform,
            requestId: nonce,
            navValue: nav,
            fee: fee,
            payout: nav - fee,
            feeBps: bps,
            dueAt: dueAt,
            expiresAt: uint64(block.timestamp + 1 hours),
            nonce: nonce,
            quoteId: AdvanceProposalLib.quoteId(platform, nav, fee, dueAt, 0, 0, uint64(block.timestamp), 1)
        });
    }

    function _sig(AdvanceProposal memory p) internal view returns (bytes memory) {
        bytes32 digest = AdvanceProposalLib.digest(p, block.chainid, address(vault));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(ENGINE_PK, digest);
        return abi.encodePacked(r, s, v);
    }
}
