// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AdvanceProposal} from "../../src/interfaces/IAdvanceProposal.sol";
import {AdvanceProposalLib} from "../../src/interfaces/AdvanceProposalLib.sol";
import {ILockgateCreditLine} from "../../src/interfaces/ILockgateCreditLine.sol";
import {CreditFacility} from "../../src/facility/CreditFacility.sol";
import {CreditLineBook} from "../../src/facility/CreditLineBook.sol";
import {FacilityMath} from "../../src/facility/libraries/FacilityMath.sol";
import {FacilityStore} from "../../src/facility/FacilityStore.sol";
import {PartnerVault} from "../../src/partner/PartnerVault.sol";
import {AdvanceStatus} from "../../src/partner/Types.sol";
import {CoreStack} from "./CoreStack.sol";

/// @notice One partner, from an empty desk through a repaid advance, a loss, and cash leaving.
///         Stage 1 is the credit line. Stage 2 is the vault. Stage 3 lends against that line.
contract PartnerLifecycleTest is CoreStack {
    uint256 internal constant ENGINE_PK = 0xA11CE;
    uint256 internal constant LINE_NAV = 10_000 * UNIT;
    uint256 internal constant PARTNER_CASH = 20_000 * UNIT;
    uint256 internal constant POSTED = 1_000 * UNIT;
    uint256 internal constant GOOD_NAV = 4_000 * UNIT;
    uint256 internal constant GOOD_FEE = 40 * UNIT;
    uint256 internal constant LOSS_NAV = 2_000 * UNIT;
    uint256 internal constant LOSS_FEE = 20 * UNIT;
    uint256 internal constant SENIOR_CASH = 8_000 * UNIT;
    uint256 internal constant JUNIOR_CASH = 2_000 * UNIT;
    uint256 internal constant DRAW = 6_000 * UNIT;

    PartnerVault internal vault;
    CreditFacility internal facility;
    address internal partner;
    address internal platform;
    address internal engine;
    address internal governor;
    address internal borrower;
    address internal senior;
    address internal junior;
    uint256 internal lineId;
    uint256 internal lineFee;
    uint256 internal goodId;
    uint256 internal lossId;

    function setUp() public {
        _core(500);
        _armSource(500 * UNIT);
        engine = vm.addr(ENGINE_PK);
        partner = vm.addr(0xB0B);
        platform = makeAddr("platform");
        governor = makeAddr("governor");
        borrower = makeAddr("borrower");
        senior = makeAddr("senior");
        junior = makeAddr("junior");
        vault = _vault(partner);
        facility = new CreditFacility(
            FacilityStore.Init({
                governor: governor,
                borrower: borrower,
                asset: address(token),
                book: address(new CreditLineBook(address(line))),
                oracle: address(0),
                minPriceE8: 0,
                maxOracleAge: 0,
                advanceRateBps: 10_000,
                maxLateBps: 10_000,
                minJuniorBps: 0,
                seniorAprBps: 0,
                juniorAprBps: 0
            })
        );
    }

    function test_onboardMandateAdvanceRepayLossAndWindDown() public {
        _onboard();
        _mandate();
        _advance();
        _repay();
        _loss();
        _windDown();
    }

    function _onboard() internal {
        _fundVault(vault, partner, PARTNER_CASH);
        assertEq(vault.owner(), partner);
        assertEq(token.balanceOf(partner), 0);
        assertEq(line.eligibleOutstanding(), 0);
        assertEq(line.lateOutstanding(), 0);
        assertEq(line.reserveOf(address(source)), 500 * UNIT);
        assertEq(line.capital(), 200_000 * UNIT);
        assertEq(facility.accounting().cash, 0);
        assertEq(token.balanceOf(address(borrower)), 0);
        _vaultAt(PARTNER_CASH, 0, 0);
    }

    function _mandate() internal {
        vm.startPrank(partner);
        vault.setProposer(engine);
        vault.setMandate(100, 30 days, 10_000, uint64(block.timestamp + 365 days));
        vault.setPlatform(platform, true, 10_000_000 * UNIT, 500, false, 1 days);
        vm.stopPrank();
        token.mint(platform, POSTED);
        vm.startPrank(platform);
        token.approve(address(vault), POSTED);
        vault.postReserve(platform, POSTED);
        vm.stopPrank();

        assertEq(uint256(vault.preview(_terms(GOOD_NAV, GOOD_FEE, 1))), 0);
        assertEq(token.balanceOf(platform), 0);
        assertEq(line.capital(), 200_000 * UNIT);
        _vaultAt(PARTNER_CASH, POSTED, 0);
    }

    function _advance() internal {
        source.refresh();
        uint256 investorBefore = token.balanceOf(investor);
        (lineId, lineFee) = source.draw(LINE_NAV);
        assertEq(lineFee, 99 * UNIT);
        assertEq(token.balanceOf(investor), investorBefore + LINE_NAV - lineFee);
        assertEq(line.eligibleOutstanding(), LINE_NAV);
        assertEq(line.outstanding(), LINE_NAV - lineFee);
        assertEq(line.capital(), 200_000 * UNIT - (LINE_NAV - lineFee));

        _put(senior, FacilityStore.Tranche.Senior, SENIOR_CASH);
        _put(junior, FacilityStore.Tranche.Junior, JUNIOR_CASH);
        assertEq(facility.availableDraw(), LINE_NAV);
        vm.prank(borrower);
        facility.draw(DRAW);
        assertEq(token.balanceOf(borrower), DRAW);
        assertEq(line.capital(), 200_000 * UNIT - (LINE_NAV - lineFee));
        _facilityAt(SENIOR_CASH + JUNIOR_CASH - DRAW, DRAW, SENIOR_CASH, JUNIOR_CASH);

        uint256 lineBook = line.eligibleOutstanding();
        AdvanceProposal memory good = _terms(GOOD_NAV, GOOD_FEE, 1);
        bytes memory sig = _sig(good);
        vm.prank(partner);
        goodId = vault.execute(good, sig, "");
        assertEq(token.balanceOf(platform), GOOD_NAV - GOOD_FEE);
        assertEq(vault.exposureOf(platform), GOOD_NAV);
        assertEq(vault.owedOf(goodId), GOOD_NAV);
        assertEq(uint256(vault.getAdvance(goodId).status), uint256(AdvanceStatus.Active));
        assertEq(line.eligibleOutstanding(), lineBook);
        _vaultAt(PARTNER_CASH - (GOOD_NAV - GOOD_FEE), POSTED, GOOD_NAV - GOOD_FEE);
    }

    function _repay() internal {
        uint256 lineCash = line.capital();
        uint256 facilityCash = token.balanceOf(address(facility));
        token.mint(platform, GOOD_FEE);
        vm.startPrank(platform);
        token.approve(address(vault), GOOD_NAV);
        vault.repay(goodId);
        vm.stopPrank();

        assertEq(token.balanceOf(platform), 0);
        assertEq(vault.exposureOf(platform), 0);
        assertEq(vault.owedOf(goodId), 0);
        assertEq(uint256(vault.getAdvance(goodId).status), uint256(AdvanceStatus.Repaid));
        assertEq(line.capital(), lineCash);
        assertEq(token.balanceOf(address(facility)), facilityCash);
        assertEq(token.balanceOf(borrower), DRAW);
        _vaultAt(PARTNER_CASH + GOOD_FEE, POSTED, 0);
    }

    function _loss() internal {
        AdvanceProposal memory bad = _terms(LOSS_NAV, LOSS_FEE, 2);
        bytes memory sig = _sig(bad);
        vm.prank(partner);
        lossId = vault.execute(bad, sig, "");
        assertEq(token.balanceOf(platform), LOSS_NAV - LOSS_FEE);
        _vaultAt(PARTNER_CASH + GOOD_FEE - (LOSS_NAV - LOSS_FEE), POSTED, LOSS_NAV - LOSS_FEE);

        ILockgateCreditLine.Advance memory lineAdvance = line.getAdvance(lineId);
        uint64 vaultDue = vault.getAdvance(lossId).dueAt;
        vm.warp(uint256(vaultDue) + vault.graceOf(lossId));
        assertGt(uint256(vaultDue) + vault.graceOf(lossId), uint256(lineAdvance.dueAt) + line.graceOf(lineId));

        line.markLate(lineId);
        assertEq(line.eligibleOutstanding(), 0);
        assertEq(line.lateOutstanding(), LINE_NAV - 500 * UNIT);
        assertEq(line.outstanding(), LINE_NAV - lineFee - 500 * UNIT);
        assertEq(line.reserveOf(address(source)), 0);
        assertEq(line.earnedFees(), 0);
        assertEq(line.capital(), 200_000 * UNIT - (LINE_NAV - lineFee) + 500 * UNIT);
        assertEq(token.balanceOf(investor), LINE_NAV - lineFee);

        facility.poke();
        _facilityAt(SENIOR_CASH + JUNIOR_CASH - DRAW, DRAW - JUNIOR_CASH, SENIOR_CASH, 0);
        uint256 loss = facility.recognizeLoss();
        assertEq(loss, DRAW - JUNIOR_CASH);
        _facilityAt(SENIOR_CASH + JUNIOR_CASH - DRAW, 0, SENIOR_CASH - (DRAW - JUNIOR_CASH), 0);
        FacilityMath.State memory booked = facility.accounting();
        assertTrue(booked.recovery);
        assertEq(booked.seniorDeficit, DRAW - JUNIOR_CASH);
        assertEq(booked.juniorDeficit, JUNIOR_CASH);

        vault.markLate(lossId);
        assertEq(vault.reserveOf(platform), 0);
        assertEq(vault.owedOf(lossId), LOSS_NAV - POSTED);
        vm.prank(partner);
        vault.writeOff(lossId);
        assertEq(uint256(vault.getAdvance(lossId).status), uint256(AdvanceStatus.WrittenOff));
        assertEq(vault.exposureOf(platform), 0);
        _vaultAt(PARTNER_CASH + GOOD_FEE - (LOSS_NAV - LOSS_FEE) + POSTED, 0, 0);
    }

    function _windDown() internal {
        uint256 partnerCash = vault.idle();
        vm.prank(partner);
        vault.withdraw(partnerCash, partner);
        assertEq(token.balanceOf(partner), partnerCash);
        assertEq(partnerCash, PARTNER_CASH + GOOD_FEE - (LOSS_NAV - LOSS_FEE) + POSTED);
        assertEq(vault.totalShares(), 0);
        _vaultAt(0, 0, 0);
        assertEq(token.balanceOf(platform), LOSS_NAV - LOSS_FEE);

        uint256 seniorBack = facility.seniorShares(senior);
        vm.prank(senior);
        uint256 redeemed = facility.redeem(FacilityStore.Tranche.Senior, seniorBack);
        assertEq(redeemed, SENIOR_CASH - (DRAW - JUNIOR_CASH));
        assertEq(token.balanceOf(senior), redeemed);
        uint256 juniorShares = facility.juniorShares(junior);
        vm.prank(junior);
        vm.expectRevert(FacilityStore.BadParam.selector);
        facility.redeem(FacilityStore.Tranche.Junior, juniorShares);
        assertEq(token.balanceOf(junior), 0);
        assertEq(token.balanceOf(borrower), DRAW);
        _facilityAt(0, 0, 0, 0);
        assertEq(facility.accounting().residual, 0);

        uint256 locked = line.capital();
        assertEq(locked, line.accountedEquity() - line.outstanding());
        line.withdrawCapital(locked);
        assertEq(line.capital(), 0);
        assertEq(token.balanceOf(address(this)), locked);
        assertEq(line.lateOutstanding(), LINE_NAV - 500 * UNIT);
        assertEq(line.eligibleOutstanding(), 0);
        assertEq(line.reserveOf(address(source)), 0);
        assertEq(token.balanceOf(investor), LINE_NAV - lineFee);
    }

    function _vaultAt(uint256 idle, uint256 reserve, uint256 principal) internal view {
        assertEq(vault.idle(), idle);
        assertEq(vault.reserveCash(), reserve);
        assertEq(vault.outstandingPrincipal(), principal);
        assertEq(vault.totalAssets(), idle + principal);
        assertEq(token.balanceOf(address(vault)), idle + reserve);
    }

    function _facilityAt(uint256 cash, uint256 drawn, uint256 seniorPrincipal, uint256 juniorPrincipal) internal view {
        FacilityMath.State memory state = facility.accounting();
        assertEq(state.cash, cash);
        assertEq(state.drawn, drawn);
        assertEq(state.seniorPrincipal, seniorPrincipal);
        assertEq(state.juniorPrincipal, juniorPrincipal);
        assertEq(token.balanceOf(address(facility)), cash);
        assertTrue(facility.solvent());
    }

    function _put(address lender, FacilityStore.Tranche tranche, uint256 amount) internal {
        vm.prank(governor);
        facility.approveLender(lender, true);
        token.mint(lender, amount);
        vm.startPrank(lender);
        token.approve(address(facility), amount);
        facility.deposit(tranche, amount);
        vm.stopPrank();
    }

    function _terms(uint256 nav, uint256 fee, uint256 nonce) internal view returns (AdvanceProposal memory p) {
        uint64 dueAt = uint64(block.timestamp + 7 days);
        p = AdvanceProposal({
            platform: platform,
            recipient: platform,
            requestId: nonce,
            navValue: nav,
            fee: fee,
            payout: nav - fee,
            feeBps: 100,
            dueAt: dueAt,
            expiresAt: uint64(block.timestamp + 1 hours),
            nonce: nonce,
            quoteId: AdvanceProposalLib.quoteId(platform, nav, fee, dueAt, 0, 0, uint64(block.timestamp), 1)
        });
    }

    function _sig(AdvanceProposal memory p) internal view returns (bytes memory) {
        bytes32 digest = AdvanceProposalLib.digest(p, block.chainid, address(vault));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(ENGINE_PK, digest);
        return abi.encodePacked(r, s, v);
    }
}
