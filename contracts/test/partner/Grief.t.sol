// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AdvanceProposal} from "../../src/interfaces/IAdvanceProposal.sol";
import {PartnerRouter} from "../../src/partner/PartnerRouter.sol";
import {PartnerVault} from "../../src/partner/PartnerVault.sol";
import {AdvanceStatus} from "../../src/partner/Types.sol";
import {VaultFixture} from "./VaultFixture.sol";

/// @notice A pile of tiny advances and repayments leaves the next withdrawal and the next repayment flat.
contract PartnerGriefTest is VaultFixture {
    uint256 internal constant COUNT = 32;
    uint256 internal constant SLACK = 25_000;
    uint256 internal constant CAP = 200_000;
    bytes32 internal constant TINY_EXIT = keccak256("grief-tiny");
    bytes32 internal constant OTHER_EXIT = keccak256("grief-other");

    address internal other;

    function setUp() public {
        _deploy();
        other = makeAddr("other-platform");
    }

    function test_tinyAdvancesDoNotBlockAnotherWithdrawalOrRepayment() public {
        (, uint256 quietWithdraw, uint256 quietRepay) = _scene(0, 0);
        uint256 partnerBefore = usdg.balanceOf(partner);
        (PartnerVault noisy, uint256 noisyWithdraw, uint256 noisyRepay) = _scene(COUNT, COUNT / 2);
        assertLt(noisyWithdraw, quietWithdraw + SLACK);
        assertLt(noisyRepay, quietRepay + SLACK);
        assertLt(noisyWithdraw, CAP);
        assertLt(noisyRepay, CAP);

        assertEq(noisy.idle(), 1_744_200 * UNIT);
        assertEq(noisy.outstandingPrincipal(), 158_400 * UNIT);
        assertEq(usdg.balanceOf(address(noisy)), noisy.idle());
        assertEq(usdg.balanceOf(partner), partnerBefore + 100_000 * UNIT);
        assertEq(noisy.exposureOf(other), 0);
        assertEq(noisy.exposureOf(platform), 160_000 * UNIT);
        assertEq(uint256(noisy.getAdvance(1).status), uint256(AdvanceStatus.Repaid));
        assertEq(noisy.owedOf(1), 0);
        for (uint256 i = 2; i < 18; ++i) {
            assertEq(noisy.owedOf(i), 0);
        }
        for (uint256 i = 18; i < 34; ++i) {
            assertEq(uint256(noisy.getAdvance(i).status), uint256(AdvanceStatus.Active));
            assertEq(noisy.owedOf(i), 10_000 * UNIT);
        }
    }

    function test_manyExitRecordsDoNotTaxAnotherRepayment() public {
        (uint256 quietOther,) = _relay(0);
        (uint256 noisyOther, uint256 tail) = _relay(COUNT);
        assertLt(noisyOther, quietOther + SLACK);
        assertLt(tail, quietOther + SLACK);
        assertLt(noisyOther, CAP);
        assertLt(tail, CAP);
    }

    function _scene(uint256 tinyCount, uint256 repayCount)
        internal
        returns (PartnerVault v, uint256 withdrawGas, uint256 repayGas)
    {
        v = _proxy(partner);
        _arm(v);
        _executeOn(v, _proposalFor(other, 100_000 * UNIT, 1, OTHER_EXIT));
        for (uint256 i; i < tinyCount; ++i) {
            _executeOn(v, _proposalFor(platform, 10_000 * UNIT, i + 2, TINY_EXIT));
        }
        for (uint256 i; i < repayCount; ++i) {
            _pay(v, platform, i + 2);
        }
        uint256 start = gasleft();
        vm.prank(partner);
        v.withdraw(100_000 * UNIT, partner);
        withdrawGas = start - gasleft();
        _fundPayer(v, other, 1);
        start = gasleft();
        vm.prank(other);
        v.repay(1);
        repayGas = start - gasleft();
    }

    function _relay(uint256 tinyCount) internal returns (uint256 otherGas, uint256 tailGas) {
        PartnerVault v = _proxy(partner);
        _arm(v);
        PartnerRouter router = new PartnerRouter();
        vm.startPrank(partner);
        v.setRouter(address(router));
        router.register(address(v));
        vm.stopPrank();
        _executeOn(v, _proposalFor(other, 100_000 * UNIT, 1, OTHER_EXIT));
        for (uint256 i; i < tinyCount; ++i) {
            _executeOn(v, _proposalFor(platform, 10_000 * UNIT, i + 2, TINY_EXIT));
        }
        _fundPayer(router, v, other, 1);
        uint256 start = gasleft();
        vm.prank(other);
        router.relayRepay(OTHER_EXIT, 0);
        otherGas = start - gasleft();
        assertEq(v.owedOf(1), 0);
        assertEq(usdg.balanceOf(address(router)), 0);
        if (tinyCount == 0) return (otherGas, 0);
        assertEq(router.recordsOf(TINY_EXIT).length, tinyCount);
        uint256 tailId = tinyCount + 1;
        _fundPayer(router, v, platform, tailId);
        start = gasleft();
        vm.prank(platform);
        router.relayRepay(TINY_EXIT, tinyCount - 1);
        tailGas = start - gasleft();
        assertEq(v.owedOf(tailId), 0);
        assertEq(v.owedOf(2), 10_000 * UNIT);
        assertEq(usdg.balanceOf(address(router)), 0);
    }

    function _arm(PartnerVault v) internal {
        vm.startPrank(partner);
        v.setProposer(engine);
        v.setMandate(100, 30 days, 10_000, uint64(block.timestamp + 365 days));
        v.setPlatform(platform, true, 10_000_000 * UNIT, 0, false, 1 days);
        v.setPlatform(other, true, 10_000_000 * UNIT, 0, false, 1 days);
        vm.stopPrank();
        usdg.mint(partner, 2_000_000 * UNIT);
        vm.startPrank(partner);
        usdg.approve(address(v), type(uint256).max);
        v.deposit(2_000_000 * UNIT);
        vm.stopPrank();
    }

    function _proposalFor(address who, uint256 nav, uint256 nonce, bytes32 exitRef)
        internal
        view
        returns (AdvanceProposal memory p)
    {
        uint256 fee = (nav * 100) / 10_000;
        p = AdvanceProposal({
            platform: who,
            recipient: who,
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
    }

    function _executeOn(PartnerVault v, AdvanceProposal memory p) internal returns (uint256 id) {
        bytes32 digest = v.hashTypedProposal(p);
        (uint8 vv, bytes32 r, bytes32 s) = vm.sign(enginePk, digest);
        vm.prank(partner);
        id = v.execute(p, abi.encodePacked(r, s, vv), "");
    }

    function _pay(PartnerVault v, address who, uint256 id) internal {
        _fundPayer(v, who, id);
        vm.prank(who);
        v.repay(id);
    }

    function _fundPayer(PartnerVault v, address who, uint256 id) internal {
        uint256 owed = v.owedOf(id);
        usdg.mint(who, owed);
        vm.prank(who);
        usdg.approve(address(v), owed);
    }

    function _fundPayer(PartnerRouter router, PartnerVault v, address who, uint256 id) internal {
        uint256 owed = v.owedOf(id);
        usdg.mint(who, owed);
        vm.prank(who);
        usdg.approve(address(router), owed);
    }
}
