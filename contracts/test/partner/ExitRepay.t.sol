// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AdvanceProposal} from "../../src/interfaces/IAdvanceProposal.sol";
import {IPartnerRouter} from "../../src/partner/interfaces/IPartnerRouter.sol";
import {PartnerRouter} from "../../src/partner/PartnerRouter.sol";
import {PartnerVault} from "../../src/partner/PartnerVault.sol";
import {VaultFixture} from "./VaultFixture.sol";

/// @notice One quote can fund two vaults. `relayRepay` clears only the record at that index.
contract ExitRepayTest is VaultFixture {
    PartnerRouter internal router;
    PartnerVault internal second;

    function setUp() public {
        _deploy();
        router = new PartnerRouter();
        second = _proxy(partner);
        vm.startPrank(partner);
        vault.setProposer(engine);
        second.setProposer(engine);
        vault.setRouter(address(router));
        second.setRouter(address(router));
        vault.setMandate(100, 30 days, 10_000, uint64(block.timestamp + 365 days));
        second.setMandate(100, 30 days, 10_000, uint64(block.timestamp + 365 days));
        vault.setPlatform(platform, true, type(uint128).max, 0, false, 1 days);
        second.setPlatform(platform, true, type(uint128).max, 0, false, 1 days);
        router.register(address(vault));
        router.register(address(second));
        vm.stopPrank();
        _deposit(1_000_000_000);
        _fundSecond(1_000_000_000);
    }

    function test_indexZeroPaysTheFirstRecordAndLeavesTheSecondPrincipal() public {
        bytes32 exitRef = keccak256("shared-exit");
        uint256 firstNav = 100_000_000;
        uint256 secondNav = 990_000_000;
        uint256 firstId = _fund(vault, firstNav, 1, exitRef);
        uint256 secondId = _fund(second, secondNav, 1, exitRef);
        IPartnerRouter.Record[] memory rows = router.recordsOf(exitRef);
        assertEq(rows.length, 2);
        assertEq(rows[0].vault, address(vault));
        assertEq(rows[0].advanceId, firstId);
        assertEq(rows[1].vault, address(second));
        assertEq(rows[1].advanceId, secondId);
        uint256 secondPrincipal = second.outstandingPrincipal();
        _relay(exitRef, 0, firstNav);
        assertEq(vault.owedOf(firstId), 0);
        assertEq(vault.outstandingPrincipal(), 0);
        assertEq(second.owedOf(secondId), secondNav);
        assertEq(second.outstandingPrincipal(), secondPrincipal);
        assertEq(secondPrincipal, secondNav - _fee(secondNav));
        assertEq(usdg.balanceOf(address(router)), 0);
        _relay(exitRef, 1, secondNav);
        assertEq(second.owedOf(secondId), 0);
        assertEq(second.outstandingPrincipal(), 0);
        assertEq(usdg.balanceOf(address(router)), 0);
        assertEq(vault.idle(), 1_000_000_000 + _fee(firstNav));
        assertEq(second.idle(), 1_000_000_000 + _fee(secondNav));
    }

    function testFuzz_eachIndexRepaysOnlyThatVault(uint96 firstRaw, uint96 secondRaw) public {
        uint256 firstNav = bound(firstRaw, 10_000, 100_000_000);
        uint256 secondNav = bound(secondRaw, 10_000, 100_000_000);
        bytes32 exitRef = keccak256("fuzz-exit");
        uint256 firstId = _fund(vault, firstNav, 3, exitRef);
        uint256 secondId = _fund(second, secondNav, 3, exitRef);
        uint256 keep = second.outstandingPrincipal();
        _relay(exitRef, 0, firstNav);
        assertEq(vault.owedOf(firstId), 0);
        assertEq(second.owedOf(secondId), secondNav);
        assertEq(second.outstandingPrincipal(), keep);
        assertEq(usdg.balanceOf(address(router)), 0);
        _relay(exitRef, 1, secondNav);
        assertEq(second.outstandingPrincipal(), 0);
        assertEq(vault.outstandingPrincipal(), 0);
        assertEq(vault.exposureOf(platform) + second.exposureOf(platform), 0);
        assertEq(usdg.balanceOf(address(router)), 0);
    }

    function _fee(uint256 nav) internal pure returns (uint256) {
        return (nav * 100) / 10_000;
    }

    function _fundSecond(uint256 amount) internal {
        usdg.mint(partner, amount);
        vm.startPrank(partner);
        usdg.approve(address(second), type(uint256).max);
        second.deposit(amount);
        vm.stopPrank();
    }

    function _fund(PartnerVault v, uint256 nav, uint256 nonce, bytes32 exitRef) internal returns (uint256 id) {
        uint256 fee = _fee(nav);
        AdvanceProposal memory p = AdvanceProposal({
            platform: platform,
            recipient: platform,
            requestId: nonce,
            navValue: nav,
            fee: fee,
            payout: nav - fee,
            feeBps: 100,
            dueAt: uint64(block.timestamp + 7 days),
            expiresAt: uint64(block.timestamp + 1 hours),
            nonce: nonce,
            quoteId: exitRef
        });
        bytes memory sig = _engineSig(v, p);
        vm.prank(partner);
        id = v.execute(p, sig, "");
    }

    function _relay(bytes32 exitRef, uint256 index, uint256 nav) internal {
        usdg.mint(platform, nav);
        vm.startPrank(platform);
        usdg.approve(address(router), nav);
        router.relayRepay(exitRef, index);
        vm.stopPrank();
    }
}
