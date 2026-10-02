// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AdvanceProposal} from "../../src/interfaces/IAdvanceProposal.sol";
import {RejectReason} from "../../src/partner/Types.sol";
import {PartnerVault} from "../../src/partner/PartnerVault.sol";
import {PartnerVaultAdmin} from "../../src/partner/PartnerVaultAdmin.sol";
import {MockPegOracle} from "./mocks/MockPegOracle.sol";
import {MockPlatform} from "./mocks/MockPlatform.sol";
import {VaultFixture} from "./VaultFixture.sol";

contract MandateTest is VaultFixture {
    function setUp() public {
        _deploy();
        _openMandate();
        _deposit(1_000_000 * UNIT);
        _reserve(100_000 * UNIT);
    }

    function test_baselinePasses() public view {
        assertEq(uint256(vault.preview(_proposal(100_000 * UNIT, 1))), uint256(RejectReason.None));
    }

    function test_unapprovedPlatformAndWrongRecipient() public {
        AdvanceProposal memory other = _proposal(100_000 * UNIT, 2);
        other.platform = makeAddr("stranger");
        other.recipient = other.platform;
        _reject(other, RejectReason.Platform);
        AdvanceProposal memory diverted = _proposal(100_000 * UNIT, 3);
        diverted.recipient = lockgate;
        _reject(diverted, RejectReason.Recipient);
    }

    function test_feeFloorAndPayoutIdentity() public {
        AdvanceProposal memory low = _proposal(100_000 * UNIT, 4);
        low.fee -= 1;
        low.payout = low.navValue - low.fee;
        _reject(low, RejectReason.Fee);
        AdvanceProposal memory ok = _proposal(100_000 * UNIT, 5);
        assertEq(uint256(vault.preview(ok)), uint256(RejectReason.None));
        ok.payout += 1;
        _reject(ok, RejectReason.Zero);
    }

    function test_tenorWindow() public {
        AdvanceProposal memory edge = _proposal(100_000 * UNIT, 6);
        edge.dueAt = uint64(block.timestamp + 30 days);
        assertEq(uint256(vault.preview(edge)), uint256(RejectReason.None));
        edge.dueAt = uint64(block.timestamp + 30 days + 1);
        _reject(edge, RejectReason.Tenor);
        AdvanceProposal memory nowDue = _proposal(100_000 * UNIT, 7);
        nowDue.dueAt = uint64(block.timestamp);
        _reject(nowDue, RejectReason.Tenor);
    }

    function test_expiryBoundary() public {
        uint64 exp = uint64(block.timestamp + 10);
        vm.prank(partner);
        vault.setMandate(100, 30 days, 10_000, exp);
        vm.warp(exp);
        assertEq(uint256(vault.preview(_proposal(100_000 * UNIT, 8))), uint256(RejectReason.None));
        vm.warp(exp + 1);
        _reject(_proposal(100_000 * UNIT, 9), RejectReason.MandateExpired);
    }

    function test_pauseLimitCashAndConcentration() public {
        vm.prank(partner);
        vault.setPaused(true);
        _reject(_proposal(100_000 * UNIT, 10), RejectReason.Paused);
        vm.prank(partner);
        vault.setPaused(false);
        vm.prank(partner);
        vault.setPlatform(platform, true, 50_000 * UNIT, 500, false, 1 days);
        _reject(_proposal(50_001 * UNIT, 11), RejectReason.Limit);
        vm.prank(partner);
        vault.setPlatform(platform, true, 10_000_000 * UNIT, 500, false, 1 days);
        _reject(_proposal(1_100_000 * UNIT, 12), RejectReason.Cash);
        vm.prank(partner);
        vault.setMandate(100, 30 days, 1_000, uint64(block.timestamp + 365 days));
        assertEq(uint256(vault.preview(_proposal(100_000 * UNIT, 13))), uint256(RejectReason.None));
        _reject(_proposal(100_000 * UNIT + 1, 14), RejectReason.Concentration);
    }

    function test_reserveShortfall() public {
        vm.prank(partner);
        vault.setPlatform(platform, true, 10_000_000 * UNIT, 1_000, false, 1 days);
        uint256 posted = vault.reserveOf(platform);
        vm.prank(platform);
        vault.withdrawReserve(platform, posted, platform);
        _reject(_proposal(100_000 * UNIT, 15), RejectReason.Reserve);
        uint256 required = 10_000 * UNIT;
        _mint(platform, required);
        vm.prank(platform);
        vault.postReserve(platform, required - 1);
        _reject(_proposal(100_000 * UNIT, 16), RejectReason.Reserve);
        vm.prank(platform);
        vault.postReserve(platform, 1);
        assertEq(uint256(vault.preview(_proposal(100_000 * UNIT, 17))), uint256(RejectReason.None));
    }

    function test_gateAndStaleNav() public {
        vm.warp(30 days);
        MockPlatform gated = new MockPlatform();
        gated.set(true, uint64(block.timestamp));
        vm.prank(partner);
        vault.setPlatform(address(gated), true, 10_000_000 * UNIT, 0, true, 1 days);
        AdvanceProposal memory p = _proposal(100_000 * UNIT, 18);
        p.platform = address(gated);
        p.recipient = address(gated);
        _reject(p, RejectReason.Gated);
        gated.set(false, uint64(block.timestamp - 2 days));
        _reject(p, RejectReason.StaleNav);
        gated.set(false, uint64(block.timestamp));
        assertEq(uint256(vault.preview(p)), uint256(RejectReason.None));
    }

    function test_pegAndStaleOracleFailClosed() public {
        vm.warp(30 days);
        MockPegOracle oracle = new MockPegOracle();
        oracle.set(1e8, uint64(block.timestamp));
        vm.prank(partner);
        vault.setOracle(address(oracle), 99_000_000, 1 hours);
        assertEq(uint256(vault.preview(_proposal(100_000 * UNIT, 19))), uint256(RejectReason.None));
        oracle.set(50_000_000, uint64(block.timestamp));
        _reject(_proposal(100_000 * UNIT, 20), RejectReason.Peg);
        oracle.set(1e8, uint64(block.timestamp - 2 hours));
        _reject(_proposal(100_000 * UNIT, 21), RejectReason.StaleOracle);
        vm.prank(partner);
        vault.setOracle(address(0), 0, 0);
        assertEq(uint256(vault.preview(_proposal(100_000 * UNIT, 22))), uint256(RejectReason.None));
    }

    /// @notice A reserve rate of 0 still funds, and the platform can withdraw the posted reserve while exposure is open.
    function test_zeroReserveRateStillFundsAndReleasesTheReserve() public {
        vm.prank(partner);
        vault.setPlatform(platform, true, 10_000_000 * UNIT, 0, false, 1 days);
        uint256 posted = vault.reserveOf(platform);
        assertEq(posted, 100_000 * UNIT);
        _execute(_proposal(100_000 * UNIT, 40));
        assertGt(vault.exposureOf(platform), 0);
        uint256 beforeBal = usdg.balanceOf(platform);
        vm.prank(platform);
        vault.withdrawReserve(platform, posted, platform);
        assertEq(vault.reserveOf(platform), 0);
        assertEq(usdg.balanceOf(platform), beforeBal + posted);
        assertGt(vault.exposureOf(platform), 0);
        assertEq(uint256(vault.preview(_proposal(100_000 * UNIT, 41))), uint256(RejectReason.None));
    }

    function _reject(AdvanceProposal memory p, RejectReason reason) internal {
        assertEq(uint256(vault.preview(p)), uint256(reason));
        bytes memory sig = _engineSig(vault, p);
        vm.prank(partner);
        vm.expectRevert(abi.encodeWithSelector(PartnerVaultAdmin.MandateRejected.selector, reason));
        vault.execute(p, sig, "");
    }
}
