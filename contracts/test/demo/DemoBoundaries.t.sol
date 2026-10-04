// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;
import {DemoFixture} from "./DemoFixture.sol";
import {DemoQuote} from "../../src/demo/DemoTypes.sol";
import {DemoRegistry} from "../../src/demo/DemoRegistry.sol";

contract DemoBoundariesTest is DemoFixture {
    function test_wrongIdentitySameActualWalletCannotExitOriginalHolding() public {
        _bind(investor, OTHER_IDENTITY, 2);
        DemoQuote memory q = _quote(1, 1); q.identity = OTHER_IDENTITY;
        bytes memory sig = _sig(ORIGINATOR_KEY, settlement.quoteDigest(q));
        vm.prank(manager); vm.expectRevert(); settlement.reserve(q, sig);
        assertEq(token.balanceOf(investor), 0); assertEq(registry.holding(HOLDING).remaining, 1_000e6);
    }
    function test_identityChangedAfterReserveBlocksSettlement() public {
        DemoQuote memory q = _quote(1, 1); bytes32 d = _reserve(q);
        _bind(investor, OTHER_IDENTITY, 2);
        bytes memory sig = _sig(INVESTOR_KEY, d);
        vm.expectRevert(); settlement.settle(q, sig);
        assertEq(vault.reservedCash(), q.payout);
        vm.prank(investor); settlement.cancel(d);
    }
    function test_forgedBindingAndReplayRejected() public {
        uint64 expiry = uint64(block.timestamp + 1 days);
        bytes32 digest = registry.identityDigest(investor, IDENTITY, expiry, 8);
        bytes memory bad = _sig(ORIGINATOR_KEY, digest);
        vm.prank(investor); vm.expectRevert(); registry.bindIdentity(IDENTITY, expiry, 8, bad);
        bytes memory good = _sig(REVIEWER_KEY, digest);
        vm.prank(investor); registry.bindIdentity(IDENTITY, expiry, 8, good);
        vm.prank(investor); vm.expectRevert(); registry.bindIdentity(IDENTITY, expiry, 8, good);
    }
    function test_bindingSignatureNotPortableAcrossWalletOrChain() public {
        uint64 expiry = uint64(block.timestamp + 1 days);
        bytes memory sig = _sig(REVIEWER_KEY, registry.identityDigest(investor, IDENTITY, expiry, 8));
        vm.prank(provider2); vm.expectRevert(); registry.bindIdentity(IDENTITY, expiry, 8, sig);
        vm.chainId(1); vm.prank(investor); vm.expectRevert(); registry.bindIdentity(IDENTITY, expiry, 8, sig);
    }
    function test_identityCannotBeReassignedEvenByAttestor() public {
        uint64 expiry = uint64(block.timestamp + 1 days);
        bytes memory sig = _sig(REVIEWER_KEY, registry.identityDigest(provider2, IDENTITY, expiry, 8));
        vm.prank(provider2); vm.expectRevert(); registry.bindIdentity(IDENTITY, expiry, 8, sig);
    }
    function test_originatorConsentAndManagerAuthorityRequired() public {
        DemoQuote memory q = _quote(1, 1); bytes32 d = settlement.quoteDigest(q);
        bytes memory bad = _sig(INVESTOR_KEY, d);
        vm.prank(manager); vm.expectRevert(); settlement.reserve(q, bad);
        bytes memory good = _sig(ORIGINATOR_KEY, d);
        vm.prank(provider); vm.expectRevert(); settlement.reserve(q, good);
    }
    function test_investorSignatureExactTermsForgeryAndReplay() public {
        DemoQuote memory q = _quote(1, 2); bytes32 d = _reserve(q);
        bytes memory bad = _sig(ORIGINATOR_KEY, d);
        vm.expectRevert(); settlement.settle(q, bad);
        bytes memory good = _sig(INVESTOR_KEY, d);
        q.agreementHash = keccak256("modified"); vm.expectRevert(); settlement.settle(q, good);
        q.agreementHash = keccak256("TEST-exit-v1"); settlement.settle(q, good);
        vm.expectRevert(); settlement.settle(q, good);
        assertEq(token.balanceOf(investor), q.payout);
    }
    function test_expiredOfferPermissionlessReleaseAndNonceRemainsSpent() public {
        DemoQuote memory q = _quote(1, 1); bytes32 d = _reserve(q);
        bytes memory sig = _sig(INVESTOR_KEY, d);
        vm.warp(q.deadline + 1); vm.expectRevert(); settlement.settle(q, sig);
        vm.prank(provider2); settlement.cancel(d);
        assertEq(vault.reservedCash(), 0); assertTrue(settlement.nonceUsed(investor, 1));
    }
    function test_unexpiredStrangerCannotCancel() public {
        bytes32 d = _reserve(_quote(1, 1)); vm.prank(provider2); vm.expectRevert(); settlement.cancel(d);
    }
    function test_dealAndAggregateLimitsIncludeConcurrentReservations() public {
        vm.prank(manager); vault.setMandate(originator, 150e6, 100e6, 3);
        _reserve(_quote(1, 1)); DemoQuote memory q = _quote(2, 1);
        bytes memory sig = _sig(ORIGINATOR_KEY, settlement.quoteDigest(q));
        vm.prank(manager); vm.expectRevert(); settlement.reserve(q, sig);
        q.payout = 101e6; q.repayment = 102e6;
        sig = _sig(ORIGINATOR_KEY, settlement.quoteDigest(q));
        vm.prank(manager); vm.expectRevert(); settlement.reserve(q, sig);
        assertEq(vault.reservedCash(), 98e6); assertEq(registry.holding(HOLDING).locked, 100e6);
    }
    function test_routeMaskAndNondivisibleHoldingAreEnforced() public {
        bytes32 id = keccak256("whole-only");
        vm.prank(originator); registry.registerHolding(id, IDENTITY, 100e6, 1, false);
        DemoQuote memory q = _quote(1, 2); q.holdingId = id;
        bytes memory sig = _sig(ORIGINATOR_KEY, settlement.quoteDigest(q));
        vm.prank(manager); vm.expectRevert(); settlement.reserve(q, sig);
        q.route = 1; q.units = 50e6; sig = _sig(ORIGINATOR_KEY, settlement.quoteDigest(q));
        vm.prank(manager); vm.expectRevert(); settlement.reserve(q, sig);
    }
    function test_sameHoldingCannotBeOversoldAcrossConcurrentQuotes() public {
        DemoQuote memory q = _quote(1, 1); q.units = 900e6; _reserve(q);
        q.nonce = 2; q.units = 101e6;
        bytes memory sig = _sig(ORIGINATOR_KEY, settlement.quoteDigest(q));
        vm.prank(manager); vm.expectRevert(); settlement.reserve(q, sig);
    }
    function test_managerCannotSweepProviderCapitalOrForgeRepayment() public {
        vm.prank(manager); vm.expectRevert(); vault.withdraw(1);
        vm.prank(manager); vm.expectRevert(); vault.claim();
        vm.prank(manager); vm.expectRevert(); vault.pay(bytes32(0), manager, 1);
        vm.prank(manager); vm.expectRevert(); vault.receiveRepayment(bytes32(0), manager, 1, 1);
    }
    function test_crossProviderSubscriptionQueueAndClaimsIsolation() public {
        vm.prank(manager); uint256 id = vault.acceptSubscription(provider, PROVIDER_ID, 10e6, uint64(block.timestamp + 1 days));
        vm.prank(provider2); vm.expectRevert(); vault.deposit(id, TERMS, 1);
        vm.prank(provider); uint256 queue = vault.requestWithdrawal(100e6);
        vm.prank(provider2); vm.expectRevert(); vault.cancelWithdrawal(queue);
        vault.processQueue(1); vm.prank(provider2); vm.expectRevert(); vault.claim();
        vm.prank(provider); vault.claim(); assertEq(token.balanceOf(provider), 600e6);
    }
    function test_subscriptionRequiresExactTermsSlippageAndSingleUse() public {
        vm.prank(manager); uint256 id = vault.acceptSubscription(provider, PROVIDER_ID, 10e6, uint64(block.timestamp + 1 days));
        vm.prank(provider); vm.expectRevert(); vault.deposit(id, bytes32(uint256(1)), 1);
        vm.prank(provider); vm.expectRevert(); vault.deposit(id, TERMS, 11e6);
        vm.prank(provider); vault.deposit(id, TERMS, 10e6);
        vm.prank(provider); vm.expectRevert(); vault.deposit(id, TERMS, 1);
    }
    function test_failedPayoutRollsBackRightsAndCash() public {
        DemoQuote memory q = _quote(1, 2); bytes32 d = _reserve(q);
        vm.mockCallRevert(address(token), abi.encodeWithSelector(token.transfer.selector, investor, q.payout), "blocked");
        bytes memory sig = _sig(INVESTOR_KEY, d);
        vm.expectRevert(); settlement.settle(q, sig);
        assertEq(registry.holding(HOLDING).remaining, 1_000e6);
        assertEq(registry.holding(HOLDING).locked, q.units);
        assertEq(vault.reservedCash(), q.payout); assertEq(settlement.deal(d).status, 1);
    }
    function test_repaymentFailureAndOverpaymentCannotChangeLedger() public {
        DemoQuote memory q = _quote(1, 1); bytes32 d = _settle(q);
        vm.prank(address(0xBAD)); vm.expectRevert(); settlement.repay(d, 1e6);
        vm.prank(originator); vm.expectRevert(); settlement.repay(d, q.repayment + 1);
        assertEq(settlement.deal(d).paid, 0); assertEq(vault.outstandingPrincipal(), q.payout);
    }
    function test_impairmentRequiresMaturityManagerAndSingleUse() public {
        DemoQuote memory q = _quote(1, 2); bytes32 d = _settle(q);
        vm.prank(manager); vm.expectRevert(); settlement.impair(d);
        vm.warp(q.maturity + 1); vm.prank(provider); vm.expectRevert(); settlement.impair(d);
        vm.prank(manager); settlement.impair(d);
        vm.prank(manager); vm.expectRevert(); settlement.impair(d);
        assertEq(settlement.deal(d).quote.repayment, q.repayment);
    }
    function test_mandateRevocationAfterReservationBlocksPayout() public {
        DemoQuote memory q = _quote(1, 1); bytes32 d = _reserve(q);
        vm.prank(manager); vault.setMandate(originator, 0, 0, 0);
        bytes memory sig = _sig(INVESTOR_KEY, d);
        vm.expectRevert(); settlement.settle(q, sig);
        assertEq(token.balanceOf(investor), 0);
        vm.prank(investor); settlement.cancel(d);
    }
    function test_failedClaimRetainsOwnershipAndReservedCash() public {
        vm.prank(provider); vault.requestWithdrawal(100e6); vault.processQueue(1);
        vm.mockCallRevert(address(token), abi.encodeWithSelector(token.transfer.selector, provider, 100e6), "blocked");
        vm.prank(provider); vm.expectRevert(); vault.claim();
        assertEq(vault.claimable(provider), 100e6); assertEq(vault.fixedClaims(), 100e6);
    }
    function test_tokenTransferWithoutReceiptCannotIssueUnits() public {
        vm.prank(manager); uint256 id = vault.acceptSubscription(provider, PROVIDER_ID, 10e6, uint64(block.timestamp + 1 days));
        vm.mockCall(address(token), abi.encodeWithSelector(token.transferFrom.selector, provider, address(vault), 10e6), abi.encode(true));
        vm.prank(provider); vm.expectRevert(); vault.deposit(id, TERMS, 1);
        assertEq(vault.bookUnits(provider), 500e6); assertEq(vault.idleCash(), 500e6);
    }
    function test_fixtureAuthorityAndProductionDeploymentGates() public {
        vm.prank(provider); vm.expectRevert(); registry.addTestIdentity(keccak256("fake"));
        vm.prank(provider); vm.expectRevert(); registry.registerHolding(keccak256("fake"), IDENTITY, 1, 1, false);
        vm.chainId(42161); vm.expectRevert(); new DemoRegistry(address(this), provider);
    }
}
