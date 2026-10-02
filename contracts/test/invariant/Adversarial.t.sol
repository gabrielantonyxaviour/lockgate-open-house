// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {MockUSDG} from "../../src/core/MockUSDG.sol";
import {AdvanceProposal} from "../../src/interfaces/IAdvanceProposal.sol";
import {PartnerRouter} from "../../src/partner/PartnerRouter.sol";
import {PartnerVault} from "../../src/partner/PartnerVault.sol";
import {PartnerVaultAdmin} from "../../src/partner/PartnerVaultAdmin.sol";
import {IPartnerRouter} from "../../src/partner/interfaces/IPartnerRouter.sol";
import {RejectReason} from "../../src/partner/Types.sol";

/// @notice Griefing, a front-run repayment, and mandate abuse against the current vault and router.
contract Adversarial is Test {
    uint256 internal constant U = 1e6;
    uint256 internal constant HONEST_NAV = 1_000 * U;
    uint256 internal constant HONEST_FEE = 10 * U;
    uint256 internal constant GRIEF_NAV = 100 * U;
    uint256 internal constant GRIEF_FEE = 1 * U;

    MockUSDG internal token;
    PartnerRouter internal router;
    PartnerVault internal grief;
    PartnerVault internal honest;
    address internal partner;
    address internal platform = makeAddr("platform");
    address internal lockgate;
    uint256 internal lockgateKey;
    bytes32 internal quoteId = keccak256("same-exit");

    function setUp() public {
        partner = makeAddr("partner");
        (lockgate, lockgateKey) = makeAddrAndKey("lockgate");
        token = new MockUSDG(address(this));
        router = new PartnerRouter(address(this));
        grief = _vault();
        honest = _vault();
    }

    /// @dev One index does not repay every vault that funded the quote.
    function test_frontRunRecordLeavesTheHonestVaultOpen() public {
        _fund(grief, GRIEF_NAV, GRIEF_FEE, 1);
        _fund(honest, HONEST_NAV, HONEST_FEE, 1);
        IPartnerRouter.Record[] memory records = router.recordsOf(quoteId);
        assertEq(records.length, 2);
        assertEq(records[0].vault, address(grief));
        assertEq(records[1].vault, address(honest));

        uint256 griefOwed = grief.owedOf(1);
        assertEq(griefOwed, GRIEF_NAV);
        vm.startPrank(platform);
        token.approve(address(router), type(uint256).max);
        router.relayRepay(quoteId, 0);
        vm.expectRevert(PartnerRouter.Empty.selector);
        router.relayRepay(quoteId, 0);
        vm.stopPrank();

        assertEq(grief.outstandingPrincipal(), 0);
        assertEq(honest.outstandingPrincipal(), HONEST_NAV - HONEST_FEE);
        assertEq(token.balanceOf(address(router)), 0);
        assertEq(token.balanceOf(lockgate), 0);
        assertEq(token.balanceOf(platform), (HONEST_NAV - HONEST_FEE) - GRIEF_FEE);
    }

    function test_strangerCanRepayTheIndexedAdvance() public {
        _fund(honest, HONEST_NAV, HONEST_FEE, 1);
        address stranger = makeAddr("stranger");
        token.mint(stranger, HONEST_NAV);
        vm.startPrank(stranger);
        token.approve(address(router), HONEST_NAV);
        router.relayRepay(quoteId, 0);
        vm.stopPrank();
        assertEq(honest.outstandingPrincipal(), 0);
        assertEq(token.balanceOf(address(router)), 0);
        vm.startPrank(platform);
        token.approve(address(router), HONEST_NAV);
        vm.expectRevert(PartnerRouter.Empty.selector);
        router.relayRepay(quoteId, 0);
        vm.stopPrank();
    }

    function test_mandateAbuseAndAPinnedNonceMoveNoCash() public {
        uint256 idle = honest.idle();
        AdvanceProposal memory badPlatform = _proposal(HONEST_NAV, HONEST_FEE, 1, makeAddr("other"));
        bytes memory signed = _sign(honest, badPlatform);
        vm.prank(partner);
        vm.expectRevert(abi.encodeWithSelector(PartnerVaultAdmin.MandateRejected.selector, RejectReason.Platform));
        honest.execute(badPlatform, signed, "");

        uint256 lowFee = (HONEST_NAV * 25) / 10_000 - 1;
        AdvanceProposal memory cheap = _proposal(HONEST_NAV, lowFee, 2, platform);
        bytes memory cheapSig = _sign(honest, cheap);
        vm.prank(partner);
        vm.expectRevert(abi.encodeWithSelector(PartnerVaultAdmin.MandateRejected.selector, RejectReason.Fee));
        honest.execute(cheap, cheapSig, "");

        AdvanceProposal memory filed = _proposal(HONEST_NAV, HONEST_FEE, 3, platform);
        bytes memory filedSig = _sign(honest, filed);
        vm.prank(lockgate);
        honest.submitProposal(filed, filedSig);
        AdvanceProposal memory swapped = _proposal(HONEST_NAV, HONEST_FEE + 1, 3, platform);
        bytes memory swappedSig = _sign(honest, swapped);
        vm.prank(partner);
        vm.expectRevert(PartnerVaultAdmin.NotSubmitted.selector);
        honest.execute(swapped, swappedSig, "");

        vm.prank(lockgate);
        vm.expectRevert(PartnerVaultAdmin.NotApproved.selector);
        honest.execute(filed, filedSig, "");

        assertEq(honest.idle(), idle);
        assertEq(honest.advanceCount(), 0);
        assertEq(token.balanceOf(platform), 0);
        assertEq(token.balanceOf(lockgate), 0);
    }

    function _fund(PartnerVault vault, uint256 nav, uint256 fee, uint256 nonce) internal {
        AdvanceProposal memory proposal = _proposal(nav, fee, nonce, platform);
        bytes memory sig = _sign(vault, proposal);
        vm.prank(partner);
        vault.execute(proposal, sig, "");
    }

    function _vault() internal returns (PartnerVault vault) {
        PartnerVault impl = new PartnerVault();
        bytes memory init = abi.encodeCall(PartnerVaultAdmin.initialize, (partner, address(token), 1 days, 1 days));
        vault = PartnerVault(address(new ERC1967Proxy(address(impl), init)));
        token.mint(partner, 5_000 * U);
        router.approveVault(address(vault), true);
        vm.startPrank(partner);
        vault.setProposer(lockgate);
        vault.setMandate(25, 30 days, 10_000, uint64(block.timestamp + 365 days));
        vault.setPlatform(platform, true, 100_000 * U, 0, false, 7 days);
        vault.setRouter(address(router));
        token.approve(address(vault), type(uint256).max);
        vault.deposit(5_000 * U);
        router.register(address(vault));
        vm.stopPrank();
    }

    function _proposal(uint256 nav, uint256 fee, uint256 nonce, address recipient)
        internal
        view
        returns (AdvanceProposal memory proposal)
    {
        proposal = AdvanceProposal({
            platform: recipient,
            recipient: recipient,
            requestId: nonce,
            navValue: nav,
            fee: fee,
            payout: nav - fee,
            feeBps: 100,
            dueAt: uint64(block.timestamp + 1 days),
            expiresAt: uint64(block.timestamp + 1 hours),
            nonce: nonce,
            quoteId: quoteId
        });
    }

    function _sign(PartnerVault vault, AdvanceProposal memory proposal) internal view returns (bytes memory) {
        bytes32 digest = vault.hashTypedProposal(proposal);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(lockgateKey, digest);
        return abi.encodePacked(r, s, v);
    }
}
