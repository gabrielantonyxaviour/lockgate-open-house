// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {PricingEngine} from "../../src/core/PricingEngine.sol";
import {IPricingEngine} from "../../src/interfaces/IPricingEngine.sol";

contract PricingFuzzTest is Test {
    PricingEngine internal pricing;

    function setUp() public {
        pricing = new PricingEngine(address(this));
    }

    function testFuzz_openQuoteStaysInsideTheBand(uint32 wait, uint32 age, uint16 util, uint16 risk, uint16 conc)
        public
        view
    {
        wait = uint32(bound(wait, 0, 120 days));
        age = uint32(bound(age, 0, 20 days));
        util = uint16(bound(util, 0, 10_000));
        risk = uint16(bound(risk, 0, 10_000));
        conc = uint16(bound(conc, 0, 10_000));
        (uint16 bps, bool ok, string memory why) = pricing.feeBpsWithRisk(wait, age, false, conc, util, risk);
        IPricingEngine.Params memory p = pricing.params();
        if (!ok) {
            assertTrue(_refused(why));
            assertEq(bps, keccak256(bytes(why)) == keccak256("fee above max") ? p.maxFeeBps : 0);
            return;
        }
        assertEq(why, "");
        assertGe(bps, p.minFeeBps);
        assertLe(bps, p.maxFeeBps);
    }

    function testFuzz_longerWaitDoesNotLowerAnOpenFee(uint32 lo, uint32 hi) public view {
        // Same open cap as PricingTest: past 9128s the default quote is "fee above max".
        uint256 open = 9128;
        lo = uint32(bound(lo, 0, open));
        hi = uint32(bound(hi, lo, open));
        (uint16 left, bool leftOk, string memory leftWhy) = pricing.feeBps(lo, 0, false, 0, 0);
        (uint16 right, bool rightOk, string memory rightWhy) = pricing.feeBps(hi, 0, false, 0, 0);
        assertTrue(leftOk, leftWhy);
        assertTrue(rightOk, rightWhy);
        assertGe(right, left);
    }

    function testFuzz_gateRejectsEveryInput(uint32 wait, uint32 age, uint16 util) public view {
        (uint16 bps, bool ok, string memory why) = pricing.feeBps(wait, age, true, util, util);
        assertFalse(ok);
        assertEq(bps, 0);
        assertEq(why, "gated");
    }

    function testFuzz_pastMaxAgeIsStale(uint32 extra) public view {
        extra = uint32(bound(extra, 1, 30 days));
        uint256 age = 7 days + uint256(extra);
        (uint16 bps, bool ok, string memory why) = pricing.feeBps(600, age, false, 0, 0);
        assertFalse(ok);
        assertEq(bps, 0);
        assertEq(why, "stale nav");
    }

    function testFuzz_ceilIsAtLeastTheHalfUpFee(uint128 nav, uint16 bps) public view {
        bps = uint16(bound(bps, 0, 10_000));
        uint256 ceilFee = pricing.feeFromBps(nav, bps);
        uint256 floorFee = uint256(nav) * bps / 10_000;
        assertGe(ceilFee, floorFee);
        if (ceilFee != floorFee) assertEq(ceilFee, floorFee + 1);
    }

    function _refused(string memory why) internal pure returns (bool) {
        bytes32 tag = keccak256(bytes(why));
        return tag == keccak256("gated") || tag == keccak256("stale nav") || tag == keccak256("tenor")
            || tag == keccak256("fee above max");
    }
}
