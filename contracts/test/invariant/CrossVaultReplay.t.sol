// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {MockUSDG} from "../../src/core/MockUSDG.sol";
import {AdvanceProposal} from "../../src/interfaces/IAdvanceProposal.sol";
import {PartnerVault} from "../../src/partner/PartnerVault.sol";
import {PartnerVaultAdmin} from "../../src/partner/PartnerVaultAdmin.sol";

/// @notice An engine signature is bound to one vault. Replaying it onto another pays nothing.
contract CrossVaultReplay is Test {
    uint256 internal constant U = 1e6;
    uint256 internal constant NAV = 1_000 * U;

    MockUSDG internal token;
    PartnerVault internal harbour;
    PartnerVault internal keppel;
    address internal partner;
    address internal platform = makeAddr("platform");
    uint256 internal lockgateKey;

    function setUp() public {
        partner = makeAddr("partner");
        address lockgate;
        (lockgate, lockgateKey) = makeAddrAndKey("lockgate");
        token = new MockUSDG(address(this));
        harbour = _vault(partner, lockgate);
        keppel = _vault(partner, lockgate);
    }

    /// @dev The failed replay must not burn the second vault's nonce.
    function test_signatureForOneVaultDoesNotFundTheOther() public {
        AdvanceProposal memory proposal = _proposal();
        bytes memory foreign = _sign(harbour, proposal);
        uint256 idle = keppel.idle();
        vm.prank(partner);
        vm.expectRevert(PartnerVaultAdmin.BadEngineSig.selector);
        keppel.execute(proposal, foreign, "");
        assertEq(keppel.idle(), idle);
        assertEq(keppel.advanceCount(), 0);
        assertEq(token.balanceOf(platform), 0);

        bytes memory local = _sign(keppel, proposal);
        vm.prank(partner);
        uint256 id = keppel.execute(proposal, local, "");
        assertEq(id, 1);
        assertEq(keppel.outstandingPrincipal(), NAV - proposal.fee);
        assertEq(token.balanceOf(platform), NAV - proposal.fee);
    }

    function _vault(address owner, address proposer) internal returns (PartnerVault vault) {
        PartnerVault impl = new PartnerVault();
        bytes memory init = abi.encodeCall(PartnerVaultAdmin.initialize, (owner, address(token), 1 days, 1 days));
        vault = PartnerVault(address(new ERC1967Proxy(address(impl), init)));
        token.mint(owner, 5_000 * U);
        vm.startPrank(owner);
        vault.setProposer(proposer);
        vault.setMandate(25, 30 days, 10_000, uint64(block.timestamp + 365 days));
        vault.setPlatform(platform, true, 100_000 * U, 0, false, 7 days);
        token.approve(address(vault), type(uint256).max);
        vault.deposit(5_000 * U);
        vm.stopPrank();
    }

    function _proposal() internal view returns (AdvanceProposal memory proposal) {
        proposal = AdvanceProposal({
            platform: platform,
            recipient: platform,
            requestId: 1,
            navValue: NAV,
            fee: 10 * U,
            payout: NAV - 10 * U,
            feeBps: 100,
            dueAt: uint64(block.timestamp + 1 days),
            expiresAt: uint64(block.timestamp + 1 hours),
            nonce: 1,
            quoteId: keccak256("cross-vault")
        });
    }

    function _sign(PartnerVault vault, AdvanceProposal memory proposal) internal view returns (bytes memory) {
        bytes32 digest = vault.hashTypedProposal(proposal);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(lockgateKey, digest);
        return abi.encodePacked(r, s, v);
    }
}
