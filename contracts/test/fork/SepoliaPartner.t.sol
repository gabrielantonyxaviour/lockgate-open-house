// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {AdvanceProposal} from "../../src/interfaces/IAdvanceProposal.sol";
import {PartnerVault} from "../../src/partner/PartnerVault.sol";
import {PartnerVaultAdmin} from "../../src/partner/PartnerVaultAdmin.sol";
import {UsdgAdapter} from "../../src/core/UsdgAdapter.sol";

/// @notice One partner-vault exit on a local fork of Arbitrum Sepolia USDG.
///         Nothing is broadcast. Lockgate does not receive the cash.
///         RPC: https://sepolia-rollup.arbitrum.io/rpc
///         Token: https://sepolia.arbiscan.io/token/0xFFC95faa3d63Cde504a05B567C600B78C0b41892
contract SepoliaPartner is Test {
    address internal constant USDG = 0xFFC95faa3d63Cde504a05B567C600B78C0b41892;
    uint256 internal constant U = 1e6;
    uint256 internal constant NAV = 10_000 * U;
    uint256 internal constant FEE = 100 * U;
    uint256 internal constant DEPOSIT = 200_000 * U;
    uint256 internal constant RESERVE = 500 * U;

    IERC20 internal token;
    PartnerVault internal vault;
    address internal partner;
    address internal platform;
    address internal lockgate;
    uint256 internal enginePk;

    function setUp() public {
        vm.createSelectFork("https://sepolia-rollup.arbitrum.io/rpc");
        token = IERC20(USDG);
        enginePk = 0xA11CE;
        partner = vm.addr(0xB0B);
        platform = makeAddr("platform");
        lockgate = makeAddr("lockgate");
        PartnerVault impl = new PartnerVault();
        bytes memory initData =
            abi.encodeCall(PartnerVaultAdmin.initialize, (partner, USDG, 1 days, 1 days));
        vault = PartnerVault(address(new ERC1967Proxy(address(impl), initData)));

        vm.startPrank(partner);
        vault.setProposer(vm.addr(enginePk));
        vault.setMandate(100, 30 days, 10_000, uint64(block.timestamp + 365 days));
        vault.setPlatform(platform, true, 1_000_000 * U, 500, false, 1 days);
        vm.stopPrank();

        deal(USDG, partner, DEPOSIT);
        vm.startPrank(partner);
        token.approve(address(vault), type(uint256).max);
        vault.deposit(DEPOSIT);
        vm.stopPrank();

        deal(USDG, platform, RESERVE);
        vm.startPrank(platform);
        token.approve(address(vault), type(uint256).max);
        vault.postReserve(platform, RESERVE);
        vm.stopPrank();
    }

    function test_repaymentReturnsToTheVaultAndLockgateTakesNothing() public {
        assertEq(block.chainid, 421_614);
        UsdgAdapter adapter = new UsdgAdapter(USDG, false);
        assertTrue(adapter.isCanonicalSepoliaUsdg());
        assertFalse(adapter.isMock());
        assertEq(vault.owner(), partner);
        uint256 idleBefore = vault.idle();
        uint256 supply = token.totalSupply();
        assertEq(idleBefore, DEPOSIT);
        assertEq(token.balanceOf(address(vault)), DEPOSIT + RESERVE);

        vm.prank(lockgate);
        vm.expectRevert(PartnerVaultAdmin.Unauthorized.selector);
        vault.withdraw(1, lockgate);
        assertEq(vault.idle(), idleBefore);
        assertEq(token.balanceOf(lockgate), 0);

        AdvanceProposal memory proposal = _proposal();
        bytes memory sig = _sign(proposal);
        vm.prank(partner);
        uint256 id = vault.execute(proposal, sig, "");
        uint256 payout = NAV - FEE;
        assertEq(id, 1);
        assertEq(token.balanceOf(platform), payout);
        assertEq(token.balanceOf(lockgate), 0);
        assertEq(vault.outstandingPrincipal(), payout);
        assertEq(vault.idle(), idleBefore - payout);
        assertEq(token.totalSupply(), supply);

        deal(USDG, platform, NAV);
        uint256 supplyAfterDeal = token.totalSupply();
        vm.prank(platform);
        vault.repay(id);
        assertEq(vault.idle(), idleBefore + FEE);
        assertEq(vault.outstandingPrincipal(), 0);
        assertEq(vault.owedOf(id), 0);
        assertEq(token.balanceOf(platform), 0);
        assertEq(token.balanceOf(lockgate), 0);
        assertEq(token.balanceOf(address(vault)), idleBefore + FEE + RESERVE);
        assertEq(token.totalSupply(), supplyAfterDeal);
    }

    function _proposal() internal view returns (AdvanceProposal memory proposal) {
        proposal = AdvanceProposal({
            platform: platform,
            recipient: platform,
            requestId: 1,
            navValue: NAV,
            fee: FEE,
            payout: NAV - FEE,
            feeBps: 100,
            dueAt: uint64(block.timestamp + 7 days),
            expiresAt: uint64(block.timestamp + 1 hours),
            nonce: 1,
            quoteId: keccak256("sepolia-partner")
        });
    }

    function _sign(AdvanceProposal memory proposal) internal view returns (bytes memory) {
        bytes32 digest = vault.hashTypedProposal(proposal);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(enginePk, digest);
        return abi.encodePacked(r, s, v);
    }
}
