// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Advance, AdvanceStatus} from "../../src/partner/Types.sol";
import {AdvanceProposal} from "../../src/interfaces/IAdvanceProposal.sol";
import {VaultFixture} from "./VaultFixture.sol";

/// @notice An advance, a repayment, and a write-off are three moves on one ledger.
contract SymmetryTest is VaultFixture {
    struct Books {
        uint256 idle;
        uint256 outstanding;
        uint256 exposure;
        uint256 assets;
        uint256 reserve;
        uint256 tokens;
    }

    function setUp() public {
        _deploy();
        vm.startPrank(partner);
        vault.setProposer(engine);
        vault.setMandate(0, 30 days, 10_000, uint64(block.timestamp + 365 days));
        vault.setPlatform(platform, true, type(uint128).max, 0, false, 1 days);
        vm.stopPrank();
        _deposit(1_000_000 * UNIT);
    }

    function testFuzz_repayInvertsTheAdvanceAndKeepsTheFee(uint128 navRaw, uint16 bpsRaw) public {
        (uint256 nav, uint256 fee, uint256 payout) = _terms(navRaw, bpsRaw);
        Books memory start = _books();
        (uint256 id, Books memory funded) = _open(nav, fee, 1);
        _repay(id, nav);
        Books memory end = _books();
        assertEq(end.outstanding, start.outstanding);
        assertEq(end.exposure, start.exposure);
        assertEq(end.idle, start.idle + fee);
        assertEq(end.assets, start.assets + fee);
        assertEq(end.reserve, start.reserve);
        assertEq(end.tokens, start.tokens + fee);
        assertEq(end.idle - funded.idle, nav);
        assertEq(funded.outstanding - end.outstanding, payout);
        assertEq(funded.exposure - end.exposure, nav);
        assertEq(end.assets - funded.assets, fee);
        _assertClosed(id, AdvanceStatus.Repaid);
        _assertLedger();
    }

    function testFuzz_writeOffInvertsPrincipalAndAbandonsTheFee(uint128 navRaw, uint16 bpsRaw) public {
        (uint256 nav, uint256 fee, uint256 payout) = _terms(navRaw, bpsRaw);
        Books memory start = _books();
        (uint256 id, Books memory funded) = _open(nav, fee, 1);
        _writeOff(id);
        Books memory end = _books();
        assertEq(end.outstanding, start.outstanding);
        assertEq(end.exposure, start.exposure);
        assertEq(end.idle, funded.idle);
        assertEq(end.tokens, funded.tokens);
        assertEq(end.reserve, funded.reserve);
        assertEq(end.idle, start.idle - payout);
        assertEq(end.assets, start.assets - payout);
        assertEq(funded.outstanding - end.outstanding, payout);
        assertEq(funded.exposure - end.exposure, nav);
        assertEq(funded.assets - end.assets, payout);
        Advance memory a = vault.getAdvance(id);
        assertEq(a.fee, fee);
        assertEq(a.principal, payout);
        _assertClosed(id, AdvanceStatus.WrittenOff);
        _assertLedger();
    }

    function testFuzz_repayAndWriteOffDifferByTheNav(uint128 navRaw, uint16 bpsRaw) public {
        (uint256 nav, uint256 fee, uint256 payout) = _terms(navRaw, bpsRaw);
        (uint256 repayId, Books memory fundedRepay) = _open(nav, fee, 1);
        _repay(repayId, nav);
        Books memory repaid = _books();
        (uint256 lossId, Books memory fundedLoss) = _open(nav, fee, 2);
        _writeOff(lossId);
        Books memory written = _books();
        uint256 repayGain = repaid.assets - fundedRepay.assets;
        uint256 writeLoss = fundedLoss.assets - written.assets;
        assertEq(repayGain, fee);
        assertEq(writeLoss, payout);
        assertEq(repayGain + writeLoss, nav);
        assertEq(repaid.idle - fundedRepay.idle, nav);
        assertEq(written.idle, fundedLoss.idle);
        assertEq(fundedRepay.outstanding - repaid.outstanding, payout);
        assertEq(fundedLoss.outstanding - written.outstanding, payout);
        assertEq(fundedRepay.exposure - repaid.exposure, nav);
        assertEq(fundedLoss.exposure - written.exposure, nav);
        assertEq(repaid.outstanding, written.outstanding);
        assertEq(repaid.exposure, written.exposure);
        assertEq(repaid.assets, written.assets + payout);
        _assertLedger();
    }

    function testFuzz_slashAndWriteOffSplitTheSameAdvance(uint128 navRaw, uint16 bpsRaw, uint128 coverRaw) public {
        uint256 nav = bound(navRaw, 2, _room());
        uint256 fee = _fee(nav, bound(bpsRaw, 0, 9_999));
        uint256 payout = nav - fee;
        uint256 cover = bound(coverRaw, 1, nav - 1);
        Books memory start = _books();
        (uint256 id,) = _open(nav, fee, 1);
        _reserve(cover);
        Books memory posted = _books();
        uint64 due = vault.getAdvance(id).dueAt;
        uint64 wait = vault.grace();
        vm.warp(uint256(due) + wait);
        vault.markLate(id);
        Advance memory late = vault.getAdvance(id);
        uint256 feePay = cover < fee ? cover : fee;
        uint256 principalPay = cover - feePay;
        uint256 lost = payout - principalPay;
        Books memory slashed = _books();
        assertEq(late.feeRemaining, fee - feePay);
        assertEq(late.principalRemaining, lost);
        assertEq(late.owed, late.feeRemaining + late.principalRemaining);
        assertEq(uint256(late.status), uint256(AdvanceStatus.Late));
        assertEq(slashed.idle, posted.idle + cover);
        assertEq(slashed.reserve, posted.reserve - cover);
        assertEq(slashed.tokens, posted.tokens);
        assertEq(slashed.outstanding, posted.outstanding - principalPay);
        assertEq(slashed.exposure, posted.exposure - cover);
        assertEq(slashed.assets, posted.assets + feePay);
        vm.prank(partner);
        vault.writeOff(id);
        Books memory end = _books();
        assertEq(end.idle, slashed.idle);
        assertEq(end.tokens, slashed.tokens);
        assertEq(end.outstanding, start.outstanding);
        assertEq(end.exposure, start.exposure);
        assertEq(end.reserve, start.reserve);
        assertEq(principalPay + lost, payout);
        assertEq(feePay + late.feeRemaining, fee);
        assertEq(end.assets, start.assets + feePay - lost);
        assertEq(end.assets, start.assets - payout + cover);
        _assertClosed(id, AdvanceStatus.WrittenOff);
        _assertLedger();
    }

    /// @dev One repayment, one slashed write-off, and one full write-off share the opening ledger.
    function testFuzz_threeClosesShareOneLedger(uint96 aRaw, uint96 bRaw, uint96 cRaw, uint16 bpsRaw, uint96 coverRaw)
        public
    {
        uint256 bps = bound(bpsRaw, 0, 9_999);
        uint256 cap = _room() / 3;
        uint256 navA = bound(aRaw, 1, cap);
        uint256 navB = bound(bRaw, 2, cap);
        uint256 navC = bound(cRaw, 1, cap);
        uint256 feeA = _fee(navA, bps);
        uint256 feeB = _fee(navB, bps);
        uint256 feeC = _fee(navC, bps);
        uint256 payoutB = navB - feeB;
        uint256 payoutC = navC - feeC;
        Books memory start = _books();
        (uint256 idA,) = _open(navA, feeA, 1);
        (uint256 idB,) = _open(navB, feeB, 2);
        (uint256 idC,) = _open(navC, feeC, 3);
        Books memory opened = _books();
        assertEq(opened.assets, start.assets);
        assertEq(opened.outstanding, (navA - feeA) + payoutB + payoutC);
        assertEq(opened.exposure, navA + navB + navC);
        assertEq(opened.idle, start.idle - opened.outstanding);
        _repay(idA, navA);
        uint256 cover = bound(coverRaw, 1, navB - 1);
        _reserve(cover);
        uint64 due = vault.getAdvance(idB).dueAt;
        vm.warp(uint256(due) + vault.grace());
        vault.markLate(idB);
        Advance memory lateB = vault.getAdvance(idB);
        vm.prank(partner);
        vault.writeOff(idB);
        vault.markLate(idC);
        Advance memory lateC = vault.getAdvance(idC);
        assertEq(lateC.principalRemaining, payoutC);
        assertEq(lateC.feeRemaining, feeC);
        assertEq(lateC.owed, navC);
        vm.prank(partner);
        vault.writeOff(idC);
        uint256 feePay = cover < feeB ? cover : feeB;
        uint256 principalPay = cover - feePay;
        uint256 lostB = payoutB - principalPay;
        Books memory end = _books();
        assertEq(principalPay + lostB, payoutB);
        assertEq(feePay + lateB.feeRemaining, feeB);
        assertEq(end.outstanding, start.outstanding);
        assertEq(end.exposure, start.exposure);
        assertEq(end.reserve, start.reserve);
        assertEq(end.assets, start.assets + feeA + feePay - lostB - payoutC);
        assertEq(end.idle, start.idle + feeA - payoutB + cover - payoutC);
        assertEq(end.tokens, end.idle + end.reserve);
        _assertClosed(idA, AdvanceStatus.Repaid);
        _assertClosed(idB, AdvanceStatus.WrittenOff);
        _assertClosed(idC, AdvanceStatus.WrittenOff);
        _assertLedger();
    }

    function _terms(uint256 navRaw, uint256 bpsRaw) internal view returns (uint256 nav, uint256 fee, uint256 payout) {
        nav = bound(navRaw, 1, _room());
        fee = _fee(nav, bound(bpsRaw, 0, 9_999));
        payout = nav - fee;
    }

    function _fee(uint256 nav, uint256 bps) internal pure returns (uint256) {
        return (nav * bps) / 10_000;
    }

    function _room() internal view returns (uint256) {
        uint256 cash = vault.idle();
        uint256 exposure = vault.exposureOf(platform);
        uint256 assets = vault.totalAssets();
        uint256 conc = assets > exposure ? assets - exposure : 0;
        return cash < conc ? cash : conc;
    }

    /// @dev Call this before any warp in the same test. `via_ir` caches `block.timestamp` here.
    function _open(uint256 nav, uint256 fee, uint256 nonce) internal returns (uint256 id, Books memory funded) {
        Books memory beforeOpen = _books();
        AdvanceProposal memory p = AdvanceProposal({
            platform: platform,
            recipient: platform,
            requestId: nonce,
            navValue: nav,
            fee: fee,
            payout: nav - fee,
            feeBps: 0,
            dueAt: uint64(block.timestamp + 7 days),
            expiresAt: uint64(block.timestamp + 1 hours),
            nonce: nonce,
            quoteId: bytes32(nonce)
        });
        id = _execute(p);
        uint256 payout = nav - fee;
        funded = _books();
        assertEq(funded.idle, beforeOpen.idle - payout);
        assertEq(funded.outstanding, beforeOpen.outstanding + payout);
        assertEq(funded.exposure, beforeOpen.exposure + nav);
        assertEq(funded.assets, beforeOpen.assets);
        assertEq(funded.reserve, beforeOpen.reserve);
        assertEq(funded.tokens, beforeOpen.tokens - payout);
        Advance memory a = vault.getAdvance(id);
        assertEq(a.navValue, nav);
        assertEq(a.principal, payout);
        assertEq(a.fee, fee);
        assertEq(a.owed, nav);
        assertEq(a.principalRemaining + a.feeRemaining, nav);
        assertEq(uint256(a.status), uint256(AdvanceStatus.Active));
    }

    function _repay(uint256 id, uint256 nav) internal {
        _mint(platform, nav);
        vm.prank(platform);
        vault.repay(id);
    }

    function _writeOff(uint256 id) internal {
        uint64 due = vault.getAdvance(id).dueAt;
        uint64 wait = vault.grace();
        vm.warp(uint256(due) + wait);
        vault.markLate(id);
        vm.prank(partner);
        vault.writeOff(id);
    }

    function _books() internal view returns (Books memory b) {
        b.idle = vault.idle();
        b.outstanding = vault.outstandingPrincipal();
        b.exposure = vault.exposureOf(platform);
        b.assets = vault.totalAssets();
        b.reserve = vault.reserveCash();
        b.tokens = usdg.balanceOf(address(vault));
    }

    function _assertClosed(uint256 id, AdvanceStatus status) internal view {
        Advance memory a = vault.getAdvance(id);
        assertEq(uint256(a.status), uint256(status));
        assertEq(a.owed, 0);
        assertEq(a.principalRemaining, 0);
        assertEq(a.feeRemaining, 0);
    }

    function _assertLedger() internal view {
        assertEq(vault.totalAssets(), vault.idle() + vault.outstandingPrincipal());
        assertEq(usdg.balanceOf(address(vault)), vault.idle() + vault.reserveCash());
        uint256 principalSum;
        uint256 owedSum;
        uint256 n = vault.advanceCount();
        for (uint256 i = 1; i <= n; ++i) {
            Advance memory a = vault.getAdvance(i);
            assertEq(a.owed, a.feeRemaining + a.principalRemaining);
            assertEq(a.principal + a.fee, a.navValue);
            principalSum += a.principalRemaining;
            owedSum += a.owed;
        }
        assertEq(principalSum, vault.outstandingPrincipal());
        assertEq(owedSum, vault.exposureOf(platform));
    }
}
