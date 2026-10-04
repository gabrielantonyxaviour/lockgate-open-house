// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;
import {DemoFixture} from "./DemoFixture.sol";
import {DemoQuote} from "../../src/demo/DemoTypes.sol";

contract DemoExposureCapsTest is DemoFixture {
    function test_capAuthorityScopeAndBpsBoundary() public {
        vm.prank(provider); vm.expectRevert(); vault.setExposureCap(originator, 2000);
        vm.prank(manager); vm.expectRevert(); vault.setExposureCap(provider, 2000);
        vm.prank(manager); vm.expectRevert(); vault.setExposureCap(originator, 10001);
        assertFalse(vault.capConfigured(originator));
        vm.prank(manager); vault.setExposureCap(originator, 2000);
        assertTrue(vault.capConfigured(originator)); assertEq(vault.capBps(originator), 2000);
    }
    function test_percentageCountsConcurrentReservationsAndCancellationReleases() public {
        vm.prank(manager); vault.setExposureCap(originator, 2000);
        DemoQuote memory first = _quote(1, 1); first.payout = 60e6;
        bytes32 digest = _reserve(first);
        DemoQuote memory second = _quote(2, 1); second.payout = 50e6;
        bytes memory sig = _sig(ORIGINATOR_KEY, settlement.quoteDigest(second));
        vm.prank(manager); vm.expectRevert(); settlement.reserve(second, sig);
        assertEq(vault.exposure(originator), 60e6);
        vm.prank(investor); settlement.cancel(digest);
        assertEq(vault.exposure(originator), 0); assertEq(vault.reservedCash(), 0);
        _reserve(second); assertEq(vault.exposure(originator), 50e6);
    }
    function test_zeroCapRevokesReservedPayoutButAllowsCancellation() public {
        vm.prank(manager); vault.setExposureCap(originator, 2000);
        DemoQuote memory q = _quote(1, 1); bytes32 digest = _reserve(q);
        vm.prank(manager); vault.setExposureCap(originator, 0);
        bytes memory sig = _sig(INVESTOR_KEY, digest);
        vm.expectRevert(); settlement.settle(q, sig);
        assertEq(token.balanceOf(investor), 0); assertEq(vault.reservedCash(), q.payout);
        vm.prank(investor); settlement.cancel(digest);
        assertEq(vault.exposure(originator), 0); assertEq(registry.holding(HOLDING).locked, 0);
        q.nonce = 2; sig = _sig(ORIGINATOR_KEY, settlement.quoteDigest(q));
        vm.prank(manager); vm.expectRevert(); settlement.reserve(q, sig);
    }
    function test_currentNavRecheckedAtPayoutAfterWithdrawal() public {
        vm.prank(manager); vault.setExposureCap(originator, 2000);
        DemoQuote memory q = _quote(1, 1); bytes32 digest = _reserve(q);
        vm.prank(provider); vault.withdraw(100e6);
        assertEq(vault.totalAssets(), 400e6);
        bytes memory sig = _sig(INVESTOR_KEY, digest);
        vm.expectRevert(); settlement.settle(q, sig);
        vm.prank(investor); settlement.cancel(digest);
        assertEq(vault.availableCash(), 400e6);
    }
    function test_lossReducesCurrentNavCapButRepaymentAndRecoveryRemainOpen() public {
        vm.prank(manager); vault.setExposureCap(originator, 2000);
        DemoQuote memory healthy = _quote(1, 1); bytes32 healthyDigest = _settle(healthy);
        bytes32 impairedDigest = _secondOriginatorLoan();
        vm.warp(healthy.maturity + 1);
        vm.prank(manager); settlement.impair(impairedDigest);
        assertEq(vault.totalAssets(), 300e6); assertEq(vault.exposure(originator), 98e6);
        DemoQuote memory next = _quote(3, 1); next.payout = 1e6; next.repayment = 1e6;
        next.deadline = healthy.maturity + 1 hours + 1;
        next.maturity = healthy.maturity + 30 days + 1;
        bytes memory sig = _sig(ORIGINATOR_KEY, settlement.quoteDigest(next));
        vm.prank(manager); vm.expectRevert(); settlement.reserve(next, sig);
        vm.prank(originator); settlement.repay(healthyDigest, healthy.repayment);
        assertEq(vault.exposure(originator), 0); assertEq(vault.totalAssets(), 301_500_000);
        next.payout = 61e6; next.repayment = 61e6;
        sig = _sig(ORIGINATOR_KEY, settlement.quoteDigest(next));
        vm.prank(manager); vm.expectRevert(); settlement.reserve(next, sig);
        next.payout = 60_300_000; next.repayment = 60_300_000; _reserve(next);
        assertEq(vault.exposure(originator), 60_300_000);
        address second = vm.addr(104); token.mint(second, 200e6);
        vm.prank(second); token.approve(address(vault), 200e6);
        vm.prank(second); settlement.repay(impairedDigest, 200e6);
        assertEq(vault.claimable(provider), 200e6);
        assertEq(vault.totalAssets(), 301_500_000);
    }
    function _secondOriginatorLoan() private returns (bytes32 digest) {
        address second = vm.addr(104); _org(second, 1);
        bytes32 holding = keccak256("second-originator-holding");
        vm.prank(second); registry.registerHolding(holding, IDENTITY, 200e6, 3, true);
        vm.prank(manager); vault.setMandate(second, 200e6, 200e6, 3);
        DemoQuote memory q = _quote(2, 2); q.holdingId = holding; q.units = 200e6;
        q.payout = 200e6; q.repayment = 200e6;
        digest = settlement.quoteDigest(q); bytes memory sig = _sig(104, digest);
        vm.prank(manager); settlement.reserve(q, sig);
        settlement.settle(q, _sig(INVESTOR_KEY, digest));
    }
}
