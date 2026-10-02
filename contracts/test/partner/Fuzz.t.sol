// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {FeeMath} from "../../src/partner/libraries/FeeMath.sol";
import {AdvanceProposal} from "../../src/interfaces/IAdvanceProposal.sol";
import {Advance} from "../../src/partner/Types.sol";
import {RejectReason} from "../../src/partner/Types.sol";
import {PartnerVault} from "../../src/partner/PartnerVault.sol";
import {PartnerVaultAdmin} from "../../src/partner/PartnerVaultAdmin.sol";
import {VaultFixture} from "./VaultFixture.sol";

contract FuzzTest is VaultFixture {
    function setUp() public {
        _deploy();
        vm.startPrank(partner);
        vault.setProposer(engine);
        vault.setMandate(100, 30 days, 10_000, uint64(block.timestamp + 365 days));
        vault.setPlatform(platform, true, type(uint128).max, 0, false, 1 days);
        vm.stopPrank();
        _deposit(1_000_000 * UNIT);
    }

    function testFuzz_feeFloor(uint128 navRaw, uint16 bps) public {
        uint256 nav = bound(navRaw, 1e6, vault.idle());
        bps = uint16(bound(bps, 1, 9_999));
        vm.prank(partner);
        vault.setMandate(bps, 30 days, 10_000, uint64(block.timestamp + 365 days));
        uint256 floorFee = FeeMath.minFee(nav, bps);
        if (floorFee == 0 || floorFee >= nav) return;
        AdvanceProposal memory p = _at(nav, floorFee, 1);
        assertEq(uint256(vault.preview(p)), uint256(RejectReason.None));
        p.fee = floorFee - 1;
        p.payout = nav - p.fee;
        assertEq(uint256(vault.preview(p)), uint256(RejectReason.Fee));
    }

    function testFuzz_withdrawCannotExceedIdle(uint96 amount) public {
        uint256 idle = vault.idle();
        uint256 draw = bound(amount, 1, idle);
        vm.prank(partner);
        vault.withdraw(draw, partner);
        assertEq(vault.idle(), idle - draw);
        uint256 left = vault.idle();
        vm.prank(partner);
        vm.expectRevert(PartnerVaultAdmin.BadParam.selector);
        vault.withdraw(left + 1, partner);
    }

    function testFuzz_concentrationCap(uint128 assetsRaw, uint16 bps) public {
        uint256 assets = bound(assetsRaw, 1e6, 1e24);
        bps = uint16(bound(bps, 1, 10_000));
        if (assets != 1_000_000 * UNIT) {
            uint256 idleNow = vault.idle();
            vm.prank(partner);
            vault.withdraw(idleNow, partner);
            _deposit(assets);
        }
        vm.prank(partner);
        vault.setMandate(0, 30 days, bps, uint64(block.timestamp + 365 days));
        uint256 cap = (assets * bps) / 10_000;
        if (cap == 0) {
            assertEq(uint256(vault.preview(_at(1, 0, 3))), uint256(RejectReason.Concentration));
            return;
        }
        assertEq(uint256(vault.preview(_at(cap, 0, 4))), uint256(RejectReason.None));
        AdvanceProposal memory over = _at(cap + 1, 0, 5);
        RejectReason reason = vault.preview(over);
        if (cap == assets) assertEq(uint256(reason), uint256(RejectReason.Cash));
        else assertEq(uint256(reason), uint256(RejectReason.Concentration));
    }

    /// @dev A reserve slash is the partial payment. It reduces the fee before principal.
    function testFuzz_slashPaysFeeBeforePrincipal(uint96 navRaw, uint96 coverRaw) public {
        uint256 nav = bound(navRaw, 10_000 * UNIT, 100_000 * UNIT);
        AdvanceProposal memory p = _proposal(nav, 11);
        uint256 id = _execute(p);
        uint256 fee = p.fee;
        uint256 principal = p.payout;
        uint256 cover = bound(coverRaw, 1, nav - 1);
        _reserve(cover);
        uint256 assetsBefore = vault.totalAssets();
        vm.warp(uint256(p.dueAt) + 1 days);
        vault.markLate(id);
        Advance memory a = vault.getAdvance(id);
        uint256 feePay = cover < fee ? cover : fee;
        uint256 principalPay = cover - feePay;
        assertEq(a.feeRemaining, fee - feePay);
        assertEq(a.principalRemaining, principal - principalPay);
        assertEq(a.owed, a.feeRemaining + a.principalRemaining);
        if (a.feeRemaining > 0) assertEq(a.principalRemaining, principal);
        assertEq(vault.outstandingPrincipal(), a.principalRemaining);
        assertEq(vault.exposureOf(platform), a.owed);
        assertEq(vault.totalAssets(), assetsBefore + feePay);
        assertEq(usdg.balanceOf(address(vault)), vault.idle() + vault.reserveCash());
    }

    function _at(uint256 nav, uint256 fee, uint256 nonce) internal view returns (AdvanceProposal memory p) {
        p = AdvanceProposal({
            platform: platform,
            recipient: platform,
            requestId: nonce,
            navValue: nav,
            fee: fee,
            payout: nav - fee,
            feeBps: 0,
            dueAt: uint64(block.timestamp + 1 days),
            expiresAt: uint64(block.timestamp + 1 hours),
            nonce: nonce,
            quoteId: bytes32(nonce)
        });
    }
}
