// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;
import {DemoFixture} from "./DemoFixture.sol";
import {DemoQuote} from "../../src/demo/DemoTypes.sol";
import {DemoRegistry} from "../../src/demo/DemoRegistry.sol";

contract DemoFlowsTest is DemoFixture {
    function test_routeAActualCashAndAcquiredRightsResidual() public {
        DemoQuote memory q = _quote(1, 1); bytes32 d = _settle(q);
        assertEq(token.balanceOf(investor), q.payout);
        assertEq(settlement.purchasedUnits(HOLDING, address(vault)), q.units);
        assertEq(settlement.dischargedUnits(HOLDING), 0);
        DemoRegistry.Holding memory h = registry.holding(HOLDING);
        assertEq(h.remaining, 900e6); assertEq(h.locked, 0);
        assertEq(vault.outstandingPrincipal(), q.payout); assertEq(vault.idleCash(), 402e6);
        vm.prank(originator); settlement.repay(d, q.repayment);
        assertEq(vault.totalAssets(), 501_500_000);
        assertEq(settlement.purchasedUnits(HOLDING, address(vault)), 0);
        assertEq(settlement.collectedUnits(HOLDING, address(vault)), q.units);
        uint256 units = vault.bookUnits(provider);
        vm.prank(provider); vault.withdraw(units);
        assertEq(token.balanceOf(provider), 1_001_500_000);
        assertEq(vault.totalUnits(), 0); assertEq(vault.totalAssets(), 0);
    }
    function test_routeBDischargeCreatesOriginatorDebtNotInvestorDebt() public {
        DemoQuote memory q = _quote(1, 2); bytes32 d = _settle(q);
        assertEq(settlement.dischargedUnits(HOLDING), q.units);
        assertEq(settlement.purchasedUnits(HOLDING, address(vault)), 0);
        assertEq(settlement.deal(d).originator, originator);
        assertEq(settlement.deal(d).quote.repayment, q.repayment);
    }
    function test_reservationExcludesWithdrawAndCancelsExactlyOnce() public {
        bytes32 d = _reserve(_quote(1, 1));
        vm.prank(provider); vm.expectRevert(); vault.withdraw(450e6);
        vm.prank(investor); settlement.cancel(d);
        assertEq(vault.reservedCash(), 0); assertEq(registry.holding(HOLDING).locked, 0);
        vm.expectRevert(); settlement.cancel(d);
        vm.prank(provider); vault.withdraw(500e6);
    }
    function test_queuePartialFillFixedClaimRepayThenFinish() public {
        DemoQuote memory q = _quote(1, 2); bytes32 d = _settle(q);
        vm.prank(provider); vault.requestWithdrawal(500e6);
        vault.processQueue(10);
        assertEq(vault.claimable(provider), 402e6); assertEq(vault.queuedUnits(provider), 98e6);
        assertEq(vault.fixedClaims(), 402e6); assertEq(vault.idleCash(), 0);
        vm.prank(provider); vault.claim(); assertEq(token.balanceOf(provider), 902e6);
        vm.prank(originator); settlement.repay(d, q.repayment);
        vault.processQueue(10);
        vm.prank(provider); vault.claim();
        assertEq(token.balanceOf(provider), 1_001_500_000); assertEq(vault.totalAssets(), 0);
    }
    function test_fifoCannotBeJumpedOrFundNewExitsWithClaimCash() public {
        _deposit(provider2, PROVIDER2_ID, 100e6);
        vm.prank(provider); vault.requestWithdrawal(500e6);
        vm.prank(provider2); vm.expectRevert(); vault.withdraw(1e6);
        DemoQuote memory q = _quote(1, 1);
        bytes memory sig = _sig(ORIGINATOR_KEY, settlement.quoteDigest(q));
        vm.prank(manager); vm.expectRevert(); settlement.reserve(q, sig);
        vault.processQueue(1);
        assertEq(vault.availableCash(), 100e6);
        assertEq(vault.fixedClaims(), 500e6);
    }
    function test_lateRecoveryBelongsToLossHoldersAfterTheirWithdrawal() public {
        _deposit(provider2, PROVIDER2_ID, 500e6);
        DemoQuote memory q = _quote(1, 2); bytes32 d = _settle(q);
        vm.warp(q.maturity + 1); vm.prank(manager); settlement.impair(d);
        assertEq(vault.totalAssets(), 902e6);
        vm.prank(provider); vault.withdraw(500e6);
        vm.prank(provider2); vault.withdraw(500e6);
        assertEq(vault.totalUnits(), 0);
        vm.prank(originator); settlement.repay(d, q.repayment);
        assertEq(vault.claimable(provider), q.repayment / 2);
        assertEq(vault.claimable(provider2), q.repayment / 2);
        vm.prank(provider); vault.claim(); vm.prank(provider2); vault.claim();
        assertEq(token.balanceOf(address(vault)), 0);
    }
    function test_newProviderCannotStealPreviousLossRecovery() public {
        DemoQuote memory q = _quote(1, 2); bytes32 d = _settle(q);
        vm.warp(q.maturity + 1); vm.prank(manager); settlement.impair(d);
        _deposit(provider2, PROVIDER2_ID, 100e6);
        vm.prank(originator); settlement.repay(d, q.repayment);
        assertEq(vault.claimable(provider), q.repayment); assertEq(vault.claimable(provider2), 0);
    }
    function test_partialRepaymentNeverOrphansUnpaidYield() public {
        DemoQuote memory q = _quote(1, 1); bytes32 d = _settle(q);
        vm.prank(originator); settlement.repay(d, q.repayment - 1);
        assertEq(vault.outstandingPrincipal(), 1);
        vm.prank(provider); vm.expectRevert(); vault.withdraw(500e6);
        vm.prank(originator); settlement.repay(d, 1);
        assertEq(vault.outstandingPrincipal(), 0);
    }
    function test_splitTinyRecoveriesCannotDivertProRataEntitlements() public {
        _deposit(provider2, PROVIDER2_ID, 500e6);
        DemoQuote memory q = _quote(1, 2); q.payout = 3; q.repayment = 3;
        bytes32 d = _settle(q); vm.warp(q.maturity + 1);
        vm.prank(manager); settlement.impair(d);
        vm.prank(originator); settlement.repay(d, 1);
        assertEq(vault.claimable(provider), 0); assertEq(vault.claimable(provider2), 0);
        vm.prank(originator); settlement.repay(d, 1);
        assertEq(vault.claimable(provider), 1); assertEq(vault.claimable(provider2), 1);
        vm.prank(provider); vault.claim();
        vm.prank(originator); settlement.repay(d, 1);
        assertEq(vault.claimable(provider2), 2); assertEq(vault.fixedClaims(), 2);
    }
    function test_expiredIdentityDoesNotConfiscateProviderRights() public {
        vm.warp(block.timestamp + 366 days);
        vm.prank(provider); vault.withdraw(500e6); assertEq(token.balanceOf(provider), 1_000e6);
    }
    function testFuzz_partialExitConservesCashAndRights(uint64 units) public {
        uint256 amount = bound(units, 1e6, 100e6);
        DemoQuote memory q = _quote(1, 1); q.units = amount; q.payout = amount; q.repayment = amount;
        _settle(q);
        assertEq(registry.holding(HOLDING).remaining + settlement.purchasedUnits(HOLDING, address(vault)), 1_000e6);
        assertEq(token.balanceOf(investor) + token.balanceOf(address(vault)), 500e6);
    }
}
