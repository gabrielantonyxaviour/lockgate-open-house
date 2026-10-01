// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {PricingEngine} from "../../src/core/PricingEngine.sol";

/// @notice On-chain fee curve. Available quotes stay inside 25–1500 bps. Above the max is refused.
contract FeeBounds is Test {
    PricingEngine internal pricing;

    function setUp() public {
        pricing = new PricingEngine(address(this));
    }

    function test_demoTenMinutesIs99BpsBeforePremiums() public view {
        (uint16 bps, bool available, string memory reason) = pricing.feeBps(600, 0, false, 0, 0);
        assertTrue(available, reason);
        assertEq(bps, 99);
        assertEq(pricing.feeFromBps(10_000e6, bps), 99e6);
    }

    /// forge-config: default.fuzz.runs = 1024
    function testFuzz_availableQuotesStayInsideTheBand(
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
        (uint16 bps, bool available, string memory reason) = pricing.feeBpsWithRisk(
            secondsTo, navAge, gated, exposureBps, utilizationBps, riskBps
        );
        if (available) {
            assertGe(bps, 25);
            assertLe(bps, 1500);
            assertEq(reason, "");
        } else if (keccak256(bytes(reason)) == keccak256("fee above max")) {
            assertEq(bps, 1500);
            assertFalse(available);
        }
    }

    function test_validateRejectsAFeeUnderTheModel() public view {
        (bool ok, string memory reason) = pricing.validate(25, 600, 0, false, 0, 0, 0);
        assertFalse(ok);
        assertEq(reason, "below model");
        (ok, reason) = pricing.validate(99, 600, 0, false, 0, 0, 0);
        assertTrue(ok, reason);
        (ok, reason) = pricing.validate(1501, 600, 0, false, 0, 0, 0);
        assertFalse(ok);
        assertEq(reason, "above max");
    }
}
