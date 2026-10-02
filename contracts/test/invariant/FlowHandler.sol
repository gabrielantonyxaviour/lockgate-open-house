// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {MockUSDG} from "../../src/core/MockUSDG.sol";
import {UsdgAdapter} from "../../src/core/UsdgAdapter.sol";
import {PricingEngine} from "../../src/core/PricingEngine.sol";
import {PlatformReserve} from "../../src/core/PlatformReserve.sol";
import {LockgateCreditLine} from "../../src/core/LockgateCreditLine.sol";
import {AdvanceProposal} from "../../src/interfaces/IAdvanceProposal.sol";
import {PartnerVault} from "../../src/partner/PartnerVault.sol";
import {PartnerVaultAdmin} from "../../src/partner/PartnerVaultAdmin.sol";
import {CreditFacility} from "../../src/facility/CreditFacility.sol";
import {FacilityStore} from "../../src/facility/FacilityStore.sol";
import {CreditActor} from "./mocks/CreditActor.sol";
import {ReceivablesBook} from "./mocks/ReceivablesBook.sol";

/// @notice Random stage 1, 2, and 3 actions on one token. Reverts are swallowed.
contract FlowHandler is Test {
    uint256 internal constant U = 1e6;

    MockUSDG public token;
    PlatformReserve public reserve;
    LockgateCreditLine public line;
    CreditActor public actor;
    PartnerVault public vault;
    CreditFacility public facility;
    address public investor;
    address public partner;
    address public platform;
    address public lockgate;
    address public senior;
    address public junior;
    address public borrower;
    uint256 public failures;
    uint256 internal lockgateKey;
    uint256 internal nextNonce = 1;

    constructor() {
        token = new MockUSDG(address(this));
        investor = makeAddr("investor");
        partner = makeAddr("partner");
        platform = makeAddr("platform");
        senior = makeAddr("senior");
        junior = makeAddr("junior");
        borrower = makeAddr("borrower");
        (lockgate, lockgateKey) = makeAddrAndKey("lockgate");
        _stage1();
        _stage2();
        _stage3();
    }

    function stage1Draw(uint256 navSeed, uint64 windowIn) external {
        uint256 nav = bound(navSeed, 1_000 * U, 8_000 * U);
        actor.refresh(uint64(bound(windowIn, 120, 800)));
        try actor.draw(nav) {} catch {}
        _lockgate();
    }

    function stage1Repay(uint256 idSeed) external {
        uint256 n = line.advanceCount();
        if (n == 0) return;
        uint256 id = bound(idSeed, 1, n);
        uint256 remaining = line.remainingOf(id);
        if (remaining == 0) return;
        token.mint(address(actor), remaining);
        try actor.repay(id) {} catch {}
        _lockgate();
    }

    function stage2Fund(uint256 navSeed, uint16 bpsSeed) external {
        uint256 nav = bound(navSeed, 1_000 * U, 8_000 * U);
        uint256 bps = bound(bpsSeed, 25, 400);
        uint256 fee = (nav * bps) / 10_000;
        if (fee == 0 || fee >= nav) return;
        _execute(_proposal(nav, fee));
        _lockgate();
    }

    function stage2Repay(uint256 idSeed) external {
        uint256 n = vault.advanceCount();
        if (n == 0) return;
        uint256 id = bound(idSeed, 1, n);
        uint256 owed = vault.owedOf(id);
        if (owed == 0) return;
        token.mint(platform, owed);
        vm.prank(platform);
        try vault.repay(id) {} catch {}
        _lockgate();
    }

    function stage2Withdraw(uint256 amountSeed) external {
        uint256 idle = vault.idle();
        if (idle < 2) return;
        uint256 amount = bound(amountSeed, 1, idle / 2);
        vm.prank(partner);
        try vault.withdraw(amount, partner) returns (uint256) {} catch {}
        _lockgate();
    }

    function stage3Draw(uint256 amountSeed) external {
        uint256 room = facility.availableDraw();
        if (room == 0) return;
        uint256 amount = bound(amountSeed, 1, room);
        vm.prank(borrower);
        try facility.draw(amount) {} catch {}
        _lockgate();
    }

    function stage3Repay(uint256 amountSeed) external {
        uint256 drawn = facility.accounting().drawn;
        if (drawn == 0) return;
        uint256 amount = bound(amountSeed, 1, drawn);
        uint256 cash = token.balanceOf(borrower);
        if (cash < amount) token.mint(borrower, amount - cash);
        vm.prank(borrower);
        try facility.repay(amount) {} catch {}
        _lockgate();
    }

    function stage3Redeem(uint256 shareSeed, uint8 which) external {
        bool seniorTranche = which % 2 == 0;
        address lender = seniorTranche ? senior : junior;
        uint256 shares = seniorTranche ? facility.seniorShares(lender) : facility.juniorShares(lender);
        if (shares < 2) return;
        uint256 burn = bound(shareSeed, 1, shares / 2);
        vm.prank(lender);
        try facility.redeem(seniorTranche ? FacilityStore.Tranche.Senior : FacilityStore.Tranche.Junior, burn) returns (
            uint256
        ) {} catch {}
        _lockgate();
    }

    /// @notice Every minted token sits in one of the stage 1, 2, or 3 accounts.
    function held() public view returns (uint256) {
        IERC20 usd = token;
        return usd.balanceOf(address(this)) + usd.balanceOf(address(line)) + usd.balanceOf(address(reserve))
            + usd.balanceOf(address(actor)) + usd.balanceOf(investor) + usd.balanceOf(partner) + usd.balanceOf(platform)
            + usd.balanceOf(address(vault)) + usd.balanceOf(lockgate) + usd.balanceOf(address(facility))
            + usd.balanceOf(senior) + usd.balanceOf(junior) + usd.balanceOf(borrower);
    }

    function _stage1() internal {
        UsdgAdapter adapter = new UsdgAdapter(address(token), true);
        PricingEngine pricing = new PricingEngine(address(this));
        reserve = new PlatformReserve(address(this), address(adapter));
        line = new LockgateCreditLine(address(this), address(adapter), address(pricing), address(reserve));
        reserve.setCreditLine(address(line));
        reserve.setSlasher(address(line), true);
        actor = new CreditActor(line, token, investor);
        line.registerSource(address(actor), 1_000_000 * U, 750);
        token.mint(address(this), 200_000 * U);
        token.approve(address(line), type(uint256).max);
        line.depositCapital(200_000 * U);
        token.mint(address(actor), 20_000 * U);
        actor.postReserve(20_000 * U);
    }

    function _stage2() internal {
        PartnerVault impl = new PartnerVault();
        bytes memory init = abi.encodeCall(PartnerVaultAdmin.initialize, (partner, address(token), 1 days, 1 days));
        vault = PartnerVault(address(new ERC1967Proxy(address(impl), init)));
        token.mint(partner, 100_000 * U);
        vm.startPrank(partner);
        vault.setProposer(lockgate);
        vault.setMandate(25, 30 days, 10_000, uint64(block.timestamp + 365 days));
        vault.setPlatform(platform, true, 1_000_000 * U, 0, false, 7 days);
        token.approve(address(vault), type(uint256).max);
        vault.deposit(100_000 * U);
        vm.stopPrank();
        vm.prank(platform);
        token.approve(address(vault), type(uint256).max);
    }

    function _stage3() internal {
        ReceivablesBook book = new ReceivablesBook();
        book.set(2_000_000 * U, 0);
        facility = new CreditFacility(
            FacilityStore.Init({
                governor: address(this),
                borrower: borrower,
                asset: address(token),
                book: address(book),
                oracle: address(0),
                minPriceE8: 0,
                maxOracleAge: 0,
                advanceRateBps: 10_000,
                maxLateBps: 2_000,
                minJuniorBps: 0,
                seniorAprBps: 0,
                juniorAprBps: 0
            })
        );
        _deposit(senior, FacilityStore.Tranche.Senior, 80_000 * U);
        _deposit(junior, FacilityStore.Tranche.Junior, 20_000 * U);
        vm.prank(borrower);
        token.approve(address(facility), type(uint256).max);
    }

    function _deposit(address lender, FacilityStore.Tranche tranche, uint256 amount) internal {
        facility.approveLender(lender, true);
        token.mint(lender, amount);
        vm.startPrank(lender);
        token.approve(address(facility), type(uint256).max);
        facility.deposit(tranche, amount);
        vm.stopPrank();
    }

    function _proposal(uint256 nav, uint256 fee) internal returns (AdvanceProposal memory proposal) {
        proposal = AdvanceProposal({
            platform: platform,
            recipient: platform,
            requestId: nextNonce,
            navValue: nav,
            fee: fee,
            payout: nav - fee,
            feeBps: uint16((fee * 10_000) / nav),
            dueAt: uint64(block.timestamp + 1 days),
            expiresAt: uint64(block.timestamp + 1 hours),
            nonce: nextNonce,
            quoteId: keccak256(abi.encode("flow", nextNonce))
        });
        nextNonce += 1;
    }

    function _execute(AdvanceProposal memory proposal) internal {
        bytes32 digest = vault.hashTypedProposal(proposal);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(lockgateKey, digest);
        bytes memory sig = abi.encodePacked(r, s, v);
        vm.prank(partner);
        try vault.execute(proposal, sig, "") returns (uint256) {} catch {}
    }

    function _lockgate() internal {
        if (token.balanceOf(lockgate) != 0) failures += 1;
    }
}
