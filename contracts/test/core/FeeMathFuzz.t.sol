// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {PricingMath} from "../../src/core/PricingMath.sol";

contract FeeMathFuzzTest is Test {
    function testFuzz_feeCeilIdentity(uint128 nav, uint16 bps) public pure {
        bps = uint16(bound(bps, 0, 10_000));
        uint256 fee = PricingMath.feeFromBps(nav, bps);
        assertLe(fee, nav);
        if (nav == 0 || bps == 0) {
            assertEq(fee, 0);
            return;
        }
        uint256 product = uint256(nav) * bps;
        assertGe(fee * 10_000, product);
        assertLt(fee * 10_000, product + 10_000);
    }

    function test_oneUnitRoundsUp() public pure {
        assertEq(PricingMath.feeFromBps(1, 1), 1);
        assertEq(PricingMath.feeFromBps(100e6, 99), 990_000);
        assertEq(PricingMath.feeFromBps(10_001, 750), 751);
    }

    function testFuzz_halfUpMatchesDefinition(uint96 x, uint96 y, uint96 den) public pure {
        den = uint96(bound(den, 1, 1e12));
        x = uint96(bound(x, 0, 1e12));
        y = uint96(bound(y, 0, 1e12));
        uint256 got = PricingMath.halfUp(x, y, den);
        uint256 expected = (uint256(x) * y + den / 2) / den;
        assertEq(got, expected);
    }
}
