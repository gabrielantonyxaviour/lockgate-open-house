// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {PricingEngine} from "../../src/core/PricingEngine.sol";
import {UsdgAdapter} from "../../src/core/UsdgAdapter.sol";
import {MockUSDG} from "../../src/core/MockUSDG.sol";

/// @notice Exact boundaries of PricingMath and the adapter. Available quotes stay inside the band.
contract FeeEdges is Test {
    PricingEngine internal pricing;

    function setUp() public {
        pricing = new PricingEngine(address(this));
    }

    function test_gatedBeatsEveryOtherInput() public view {
        (uint16 bps, bool available, string memory reason) = pricing.feeBpsWithRisk(600, 0, true, 0, 0, 0);
        assertFalse(available);
        assertEq(bps, 0);
        assertEq(reason, "gated");
        (bps, available, reason) = pricing.feeBpsWithRisk(1, 8 days, true, 10_000, 10_000, 10_000);
        assertFalse(available);
        assertEq(reason, "gated");
    }

    function test_navAgeBoundaryIsStrict() public view {
        (uint16 bps, bool available, string memory reason) = pricing.feeBps(600, 7 days, false, 0, 0);
        assertTrue(available, reason);
        assertGt(bps, 99);
        assertLe(bps, 1500);
        (bps, available, reason) = pricing.feeBps(600, 7 days + 1, false, 0, 0);
        assertFalse(available);
        assertEq(bps, 0);
        assertEq(reason, "stale nav");
    }

    function test_tenorBoundaryIsStrictAndAWeekIsRefused() public view {
        (uint16 atCap,, string memory atReason) = pricing.feeBps(366 days, 0, false, 0, 0);
        assertEq(atReason, "fee above max");
        assertEq(atCap, 1500);
        (uint16 bps, bool available, string memory reason) = pricing.feeBps(366 days + 1, 0, false, 0, 0);
        assertFalse(available);
        assertEq(bps, 0);
        assertEq(reason, "tenor");
        (bps, available, reason) = pricing.feeBps(7 days, 0, false, 0, 0);
        assertFalse(available);
        assertEq(reason, "fee above max");
        assertEq(bps, 1500);
    }

    function test_demoScaleIs99NotTheSimulatorFloor() public view {
        (uint16 bps, bool available, string memory reason) = pricing.feeBps(600, 0, false, 0, 0);
        assertTrue(available, reason);
        assertEq(bps, 99);
    }

    /// forge-config: default.fuzz.runs = 1024
    function testFuzz_feeFromBpsRoundsUp(uint256 nav, uint16 bps) public view {
        nav = bound(nav, 0, 1e24);
        bps = uint16(bound(bps, 0, 10_000));
        uint256 fee = pricing.feeFromBps(nav, bps);
        assertGe(fee * 10_000, nav * bps);
        if (fee > 0) assertLt((fee - 1) * 10_000, nav * bps);
    }

    /// forge-config: default.fuzz.runs = 1024
    function testFuzz_refusalReasonIsOneOfTheKnownCodes(
        uint256 secondsTo,
        uint256 navAge,
        bool gated,
        uint16 exposureBps,
        uint16 utilizationBps,
        uint16 riskBps
    ) public view {
        secondsTo = bound(secondsTo, 0, 400 days);
        navAge = bound(navAge, 0, 30 days);
        exposureBps = uint16(bound(exposureBps, 0, 10_000));
        utilizationBps = uint16(bound(utilizationBps, 0, 10_000));
        riskBps = uint16(bound(riskBps, 0, 10_000));
        (uint16 bps, bool available, string memory reason) =
            pricing.feeBpsWithRisk(secondsTo, navAge, gated, exposureBps, utilizationBps, riskBps);
        if (gated) {
            assertFalse(available);
            assertEq(reason, "gated");
            assertEq(bps, 0);
            return;
        }
        if (navAge > 7 days) {
            assertFalse(available);
            assertEq(reason, "stale nav");
            return;
        }
        if (secondsTo > 366 days) {
            assertFalse(available);
            assertEq(reason, "tenor");
            return;
        }
        if (available) {
            assertGe(bps, 25);
            assertLe(bps, 1500);
            assertEq(reason, "");
        } else {
            assertEq(reason, "fee above max");
            assertEq(bps, 1500);
        }
    }

    function test_adapterRejectsZeroAndEighteenDecimals() public {
        vm.expectRevert(UsdgAdapter.ZeroAddress.selector);
        new UsdgAdapter(address(0), true);
        Eighteen eighteen = new Eighteen();
        vm.expectRevert(abi.encodeWithSelector(UsdgAdapter.BadDecimals.selector, 18));
        new UsdgAdapter(address(eighteen), false);
        MockUSDG token = new MockUSDG(address(this));
        UsdgAdapter adapter = new UsdgAdapter(address(token), true);
        assertTrue(adapter.isMock());
        assertFalse(adapter.isCanonicalSepoliaUsdg());
        assertEq(adapter.decimals(), 6);
    }
}

contract Eighteen {
    function decimals() external pure returns (uint8) {
        return 18;
    }
}
