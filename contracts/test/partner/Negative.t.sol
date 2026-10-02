// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {AdvanceProposal} from "../../src/interfaces/IAdvanceProposal.sol";
import {AutoApproveModule} from "../../src/partner/AutoApproveModule.sol";
import {PartnerRouter} from "../../src/partner/PartnerRouter.sol";
import {PartnerVaultAdmin} from "../../src/partner/PartnerVaultAdmin.sol";
import {FeeMath} from "../../src/partner/libraries/FeeMath.sol";
import {RejectReason} from "../../src/partner/Types.sol";
import {ReenterPlatform} from "./mocks/ReenterPlatform.sol";
import {VaultFixture} from "./VaultFixture.sol";

contract PartnerNegativeTest is VaultFixture {
    function setUp() public {
        _deploy();
        _openMandate();
        _deposit(1_000_000 * UNIT);
        _reserve(50_000 * UNIT);
    }

    function test_strangerCannotGovernOrTakeReserve() public {
        address stranger = makeAddr("stranger");
        vm.startPrank(stranger);
        vm.expectRevert(PartnerVaultAdmin.Unauthorized.selector);
        vault.deposit(1);
        vm.expectRevert(PartnerVaultAdmin.Unauthorized.selector);
        vault.withdraw(1, stranger);
        vm.expectRevert(PartnerVaultAdmin.Unauthorized.selector);
        vault.setMandate(0, 1, 1, 1);
        vm.expectRevert(PartnerVaultAdmin.Unauthorized.selector);
        vault.cancel(1);
        vm.expectRevert(PartnerVaultAdmin.Unauthorized.selector);
        vault.writeOff(1);
        vm.expectRevert(PartnerVaultAdmin.Unauthorized.selector);
        vault.withdrawReserve(platform, 1, stranger);
        vm.stopPrank();
        vm.prank(partner);
        vm.expectRevert(PartnerVaultAdmin.Unauthorized.selector);
        vault.withdrawReserve(platform, 1, partner);
        assertEq(vault.owner(), partner);
        assertEq(vault.reserveOf(platform), 50_000 * UNIT);
    }

    function test_revokedSignerCannotExecute() public {
        address signer = vm.addr(0xBEE);
        vm.prank(partner);
        vault.setPartnerSigner(signer);
        AdvanceProposal memory first = _proposal(10_000 * UNIT, 1);
        bytes memory firstSig = _engineSig(vault, first);
        vm.prank(signer);
        vault.execute(first, firstSig, "");
        vm.prank(partner);
        vault.setPartnerSigner(address(0));
        AdvanceProposal memory next = _proposal(10_000 * UNIT, 2);
        bytes memory sig = _engineSig(vault, next);
        vm.prank(signer);
        vm.expectRevert(PartnerVaultAdmin.NotApproved.selector);
        vault.execute(next, sig, "");
        assertEq(vault.advanceCount(), 1);
        assertEq(usdg.balanceOf(signer), 0);
    }

    function test_revokedPlatformAndExpiredMandateBlockTheNextAdvance() public {
        uint256 id = _execute(_proposal(10_000 * UNIT, 3));
        vm.prank(partner);
        vault.setPlatform(platform, false, 0, 0, false, 0);
        AdvanceProposal memory blocked = _proposal(10_000 * UNIT, 4);
        bytes memory blockedSig = _engineSig(vault, blocked);
        vm.prank(partner);
        vm.expectRevert(abi.encodeWithSelector(PartnerVaultAdmin.MandateRejected.selector, RejectReason.Platform));
        vault.execute(blocked, blockedSig, "");
        vm.prank(platform);
        vm.expectRevert(PartnerVaultAdmin.BadParam.selector);
        vault.postReserve(platform, 1);
        uint256 owed = vault.owedOf(id);
        usdg.mint(platform, owed);
        vm.startPrank(platform);
        usdg.approve(address(vault), owed);
        vault.repay(id);
        vm.stopPrank();
        assertEq(vault.owedOf(id), 0);
        vm.prank(partner);
        vault.setPlatform(platform, true, 10_000_000 * UNIT, 500, false, 1 days);
        vm.prank(partner);
        vault.setMandate(100, 30 days, 10_000, 1);
        vm.warp(2);
        AdvanceProposal memory late = _proposal(10_000 * UNIT, 5);
        bytes memory lateSig = _engineSig(vault, late);
        vm.prank(partner);
        vm.expectRevert(abi.encodeWithSelector(PartnerVaultAdmin.MandateRejected.selector, RejectReason.MandateExpired));
        vault.execute(late, lateSig, "");
        assertEq(vault.advanceCount(), 1);
    }

    function test_clearedModuleAndStrangerCannotRegister() public {
        AutoApproveModule module = new AutoApproveModule(
            partner,
            address(vault),
            AutoApproveModule.Bounds(50_000 * UNIT, 50_000 * UNIT, 100, 30 days, true, false, 100)
        );
        vm.prank(partner);
        vault.setAutoModule(address(module));
        vm.prank(partner);
        vault.setAutoModule(address(0));
        AdvanceProposal memory p = _proposal(10_000 * UNIT, 6);
        bytes memory moduleSig = _engineSig(vault, p);
        vm.expectRevert(PartnerVaultAdmin.NotApproved.selector);
        module.execute(p, moduleSig);
        PartnerRouter router = new PartnerRouter(address(this));
        vm.prank(makeAddr("stranger"));
        vm.expectRevert(PartnerRouter.NotOwner.selector);
        router.register(address(vault));
        assertEq(router.vaultCount(), 0);
    }

    function test_shortFeeAndReserveCeilDoNotReleaseCash() public {
        assertEq(FeeMath.mulDivHalfUp(1, 1, 2), 1);
        assertEq(FeeMath.minFee(1, 5_000), 0);
        uint256 nav = 10_000 * UNIT + 1;
        AdvanceProposal memory cheap = _proposal(nav, 7);
        uint256 floorFee = FeeMath.minFee(nav, 100);
        cheap.fee = floorFee - 1;
        cheap.payout = nav - cheap.fee;
        uint256 bal = usdg.balanceOf(address(vault));
        bytes memory cheapSig = _engineSig(vault, cheap);
        vm.prank(partner);
        vm.expectRevert(abi.encodeWithSelector(PartnerVaultAdmin.MandateRejected.selector, RejectReason.Fee));
        vault.execute(cheap, cheapSig, "");
        assertEq(usdg.balanceOf(address(vault)), bal);
        _execute(_proposal(nav, 8));
        uint256 required = Math.mulDiv(vault.exposureOf(platform), 500, 10_000, Math.Rounding.Ceil);
        assertEq(required, (nav * 500) / 10_000 + 1);
        uint256 excess = vault.reserveOf(platform) - required;
        vm.prank(platform);
        vault.withdrawReserve(platform, excess, platform);
        vm.prank(platform);
        vm.expectRevert(abi.encodeWithSelector(PartnerVaultAdmin.MandateRejected.selector, RejectReason.Reserve));
        vault.withdrawReserve(platform, 1, platform);
        assertEq(vault.reserveOf(platform), required);
    }

    function test_withdrawReentrancyPaysOnce() public {
        ReenterPlatform sink = new ReenterPlatform();
        sink.arm(address(vault));
        usdg.setHook(address(sink));
        uint256 idle = vault.idle();
        vm.prank(partner);
        vault.withdraw(UNIT, address(sink));
        assertFalse(sink.withdrew());
        assertEq(sink.withdrawSel(), ReentrancyGuard.ReentrancyGuardReentrantCall.selector);
        assertEq(usdg.balanceOf(address(sink)), UNIT);
        assertEq(vault.idle(), idle - UNIT);
    }
}
