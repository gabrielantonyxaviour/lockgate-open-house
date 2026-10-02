// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {AdvanceProposal} from "../../src/interfaces/IAdvanceProposal.sol";
import {PartnerRouter} from "../../src/partner/PartnerRouter.sol";
import {Advance, AdvanceStatus} from "../../src/partner/Types.sol";
import {VaultFixture} from "./VaultFixture.sol";

/// @dev Pretends to be a vault: `owner()` is the attacker and `getAdvance` echoes whatever it reports.
contract GriefVault {
    address public immutable owner;
    address public immutable asset;
    Advance internal _advance;

    constructor(address attacker, address token) {
        owner = attacker;
        asset = token;
    }

    function getAdvance(uint256) external view returns (Advance memory) {
        return _advance;
    }

    function owedOf(uint256) external pure returns (uint256) {
        return 1;
    }

    function repay(uint256) external {}

    function grief(PartnerRouter router, bytes32 exitRef, address platform, uint256 nav, uint256 fee) external {
        _advance.platform = platform;
        _advance.navValue = nav;
        _advance.fee = fee;
        _advance.exitRef = exitRef;
        _advance.status = AdvanceStatus.Active;
        router.notifyFunded(exitRef, 1, platform, nav, fee);
    }
}

/// @notice Regression for G9 P0: an unvetted contract whose `owner()` is the attacker used to list itself, record
///         an honest exit's `exitRef` first, and soak up `relayRepay(exitRef, 0)` while the honest vault stayed open.
contract RouterGriefTest is VaultFixture {
    PartnerRouter internal router;
    address internal attacker;
    bytes32 internal constant EXIT = keccak256("honest-exit");
    uint256 internal constant NAV = 100_000_000;

    function setUp() public {
        _deploy();
        attacker = makeAddr("attacker");
        router = new PartnerRouter(lockgate);
        vm.prank(lockgate);
        router.approveVault(address(vault), true);
        vm.startPrank(partner);
        vault.setProposer(engine);
        vault.setRouter(address(router));
        vault.setMandate(100, 30 days, 10_000, uint64(block.timestamp + 365 days));
        vault.setPlatform(platform, true, type(uint128).max, 0, false, 1 days);
        router.register(address(vault));
        vm.stopPrank();
        _deposit(1_000_000_000);
    }

    function test_griefVaultCannotListOrRecordAndHonestVaultIsRepaid() public {
        GriefVault grief = new GriefVault(attacker, address(usdg));
        vm.prank(attacker);
        vm.expectRevert(PartnerRouter.NotApproved.selector);
        router.register(address(grief));
        vm.expectRevert(PartnerRouter.UnknownVault.selector);
        grief.grief(router, EXIT, platform, NAV, NAV / 100);
        vm.prank(attacker);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, attacker));
        router.approveVault(address(grief), true);

        uint256 id = _fund(EXIT);
        PartnerRouter.Record[] memory rows = router.recordsOf(EXIT);
        assertEq(rows.length, 1);
        assertEq(rows[0].vault, address(vault));
        usdg.mint(platform, NAV);
        vm.startPrank(platform);
        usdg.approve(address(router), NAV);
        router.relayRepay(EXIT, 0);
        vm.stopPrank();
        assertEq(vault.owedOf(id), 0);
        assertEq(usdg.balanceOf(address(router)), 0);
    }

    function test_revokedVaultIsDelistedButItsRecordStaysRepayable() public {
        uint256 id = _fund(EXIT);
        vm.prank(lockgate);
        router.approveVault(address(vault), false);
        assertEq(router.vaultCount(), 0);
        vm.prank(partner);
        vm.expectRevert(PartnerRouter.NotApproved.selector);
        router.register(address(vault));
        usdg.mint(platform, NAV);
        vm.startPrank(platform);
        usdg.approve(address(router), NAV);
        router.relayRepay(EXIT, 0);
        vm.stopPrank();
        assertEq(vault.owedOf(id), 0);
    }

    function test_sameAdvanceCannotBeRecordedTwice() public {
        uint256 id = _fund(EXIT);
        vm.prank(address(vault));
        vm.expectRevert(PartnerRouter.Duplicate.selector);
        router.notifyFunded(EXIT, id, platform, NAV, NAV / 100);
    }

    function _fund(bytes32 exitRef) internal returns (uint256 id) {
        uint256 fee = NAV / 100;
        AdvanceProposal memory p = AdvanceProposal({
            platform: platform,
            recipient: platform,
            requestId: 1,
            navValue: NAV,
            fee: fee,
            payout: NAV - fee,
            feeBps: 100,
            dueAt: uint64(block.timestamp + 7 days),
            expiresAt: uint64(block.timestamp + 1 hours),
            nonce: 1,
            quoteId: exitRef
        });
        bytes memory sig = _engineSig(vault, p);
        vm.prank(partner);
        id = vault.execute(p, sig, "");
    }
}
