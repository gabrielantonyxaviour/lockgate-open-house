// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {MockUSDG} from "../../src/core/MockUSDG.sol";
import {AdvanceProposal} from "../../src/interfaces/IAdvanceProposal.sol";
import {PartnerRouter} from "../../src/partner/PartnerRouter.sol";
import {PartnerVault} from "../../src/partner/PartnerVault.sol";
import {PartnerVaultAdmin} from "../../src/partner/PartnerVaultAdmin.sol";
import {RejectReason} from "../../src/partner/Types.sol";

/// @notice Lockgate can propose. It cannot move, pause, reconfigure, or upgrade a partner vault.
contract PartnerKeys is Test {
    uint256 internal constant U = 1e6;
    uint256 internal constant NAV = 10_000 * U;

    MockUSDG internal token;
    PartnerVault internal vault;
    PartnerRouter internal router;
    address internal partner;
    address internal platform = makeAddr("platform");
    address internal lockgate;
    uint256 internal lockgateKey;
    uint256 internal nextNonce = 1;

    function setUp() public {
        partner = makeAddr("partner");
        (lockgate, lockgateKey) = makeAddrAndKey("lockgate");
        token = new MockUSDG(address(this));
        PartnerVault impl = new PartnerVault();
        bytes memory init = abi.encodeCall(PartnerVaultAdmin.initialize, (partner, address(token), 1 days, 1 days));
        vault = PartnerVault(address(new ERC1967Proxy(address(impl), init)));
        router = new PartnerRouter(address(this));

        token.mint(partner, 50_000 * U);
        router.approveVault(address(vault), true);
        vm.startPrank(partner);
        vault.setProposer(lockgate);
        vault.setMandate(25, 30 days, 10_000, uint64(block.timestamp + 365 days));
        vault.setPlatform(platform, true, 100_000 * U, 0, false, 7 days);
        vault.setRouter(address(router));
        token.approve(address(vault), type(uint256).max);
        vault.deposit(50_000 * U);
        router.register(address(vault));
        vm.stopPrank();
    }

    function test_lockgateCannotMoveOrGovernFunds() public {
        uint256 idleBefore = vault.idle();
        vm.startPrank(lockgate);
        vm.expectRevert(PartnerVaultAdmin.Unauthorized.selector);
        vault.withdraw(1 * U, lockgate);
        vm.expectRevert(PartnerVaultAdmin.Unauthorized.selector);
        vault.withdrawReserve(platform, 1, lockgate);
        vm.expectRevert(PartnerVaultAdmin.Unauthorized.selector);
        vault.setMandate(1, 1 days, 1, uint64(block.timestamp + 1 days));
        vm.expectRevert(PartnerVaultAdmin.Unauthorized.selector);
        vault.setPaused(true);
        vm.expectRevert(PartnerVaultAdmin.Unauthorized.selector);
        vault.scheduleUpgrade(address(vault));
        vm.expectRevert(PartnerVaultAdmin.Unauthorized.selector);
        vault.executeUpgrade();
        vm.stopPrank();
        assertEq(vault.idle(), idleBefore);
        assertEq(token.balanceOf(lockgate), 0);
        assertEq(token.balanceOf(address(router)), 0);
    }

    function test_badEngineSignatureAndReplayDoNotPay() public {
        AdvanceProposal memory proposal = _proposal(100 * U, platform);
        bytes memory bad = _sign(lockgateKey, proposal);
        bad[bad.length - 1] ^= 0x01;
        vm.prank(partner);
        vm.expectRevert(PartnerVaultAdmin.BadEngineSig.selector);
        vault.execute(proposal, bad, "");

        bytes memory sig = _sign(lockgateKey, proposal);
        vm.prank(partner);
        vault.execute(proposal, sig, "");
        vm.prank(partner);
        vm.expectRevert(PartnerVaultAdmin.NonceUsed.selector);
        vault.execute(proposal, sig, "");
        assertEq(token.balanceOf(lockgate), 0);
    }

    function test_outsideMandateMovesNothing() public {
        address other = makeAddr("other");
        AdvanceProposal memory proposal = _proposal(100 * U, other);
        uint256 idleBefore = vault.idle();
        uint256 platformBefore = token.balanceOf(platform);
        bytes memory sig = _sign(lockgateKey, proposal);
        vm.prank(partner);
        vm.expectRevert(abi.encodeWithSelector(PartnerVaultAdmin.MandateRejected.selector, RejectReason.Platform));
        vault.execute(proposal, sig, "");
        assertEq(vault.idle(), idleBefore);
        assertEq(token.balanceOf(platform), platformBefore);
        assertEq(vault.advanceCount(), 0);
    }

    function test_repaymentReturnsToTheFundingVault() public {
        AdvanceProposal memory proposal = _proposal(100 * U, platform);
        uint256 idleBefore = vault.idle();
        bytes memory sig = _sign(lockgateKey, proposal);
        vm.prank(partner);
        uint256 id = vault.execute(proposal, sig, "");
        uint256 principal = NAV - 100 * U;
        assertEq(token.balanceOf(platform), principal);
        assertEq(token.balanceOf(lockgate), 0);
        assertEq(vault.outstandingPrincipal(), principal);
        assertEq(id, 1);

        token.mint(platform, 100 * U);
        vm.startPrank(platform);
        token.approve(address(router), NAV);
        router.relayRepay(proposal.quoteId, 0);
        vm.stopPrank();

        assertEq(vault.idle(), idleBefore + 100 * U);
        assertEq(vault.outstandingPrincipal(), 0);
        assertEq(token.balanceOf(address(router)), 0);
        assertEq(token.balanceOf(lockgate), 0);
        assertEq(vault.owedOf(id), 0);
    }

    function test_lockgateSignatureAloneDoesNotExecute() public {
        AdvanceProposal memory proposal = _proposal(100 * U, platform);
        bytes memory sig = _sign(lockgateKey, proposal);
        vm.prank(lockgate);
        vm.expectRevert(PartnerVaultAdmin.NotApproved.selector);
        vault.execute(proposal, sig, "");
        assertEq(vault.advanceCount(), 0);
    }

    function _proposal(uint256 fee, address recipient) internal returns (AdvanceProposal memory proposal) {
        proposal = AdvanceProposal({
            platform: recipient,
            recipient: recipient,
            requestId: nextNonce,
            navValue: NAV,
            fee: fee,
            payout: NAV - fee,
            feeBps: 100,
            dueAt: uint64(block.timestamp + 1 days),
            expiresAt: uint64(block.timestamp + 1 hours),
            nonce: nextNonce,
            quoteId: keccak256(abi.encode("quote", nextNonce))
        });
        nextNonce += 1;
    }

    function _sign(uint256 key, AdvanceProposal memory proposal) internal view returns (bytes memory) {
        bytes32 digest = vault.hashTypedProposal(proposal);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, digest);
        return abi.encodePacked(r, s, v);
    }
}
