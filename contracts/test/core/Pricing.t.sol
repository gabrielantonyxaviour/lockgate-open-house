// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {CoreFixture} from "./Support.sol";
import {IPricingEngine} from "../../src/interfaces/IPricingEngine.sol";
import {PricingEngine} from "../../src/core/PricingEngine.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

contract PricingTest is CoreFixture {
    function setUp() public {
        _core();
    }

    function test_demoWaitIsAboutOnePercent() public view {
        (uint16 bps, bool ok, string memory why) = pricing.feeBps(600, 0, false, 0, 0);
        assertTrue(ok);
        assertEq(why, "");
        assertEq(bps, 99);
        (bps, ok,) = pricing.feeBps(599, 0, false, 0, 0);
        assertTrue(ok);
        assertEq(bps, 98, "599s");
        (bps, ok,) = pricing.feeBps(596, 0, false, 0, 0);
        assertTrue(ok);
        assertEq(bps, 98, "596s");
        (bps, ok,) = pricing.feeBps(606, 0, false, 0, 0);
        assertTrue(ok);
        assertEq(bps, 100, "606s");
        (bps, ok,) = pricing.feeBps(0, 0, false, 0, 0);
        assertTrue(ok);
        assertEq(bps, 25);
    }

    function test_feeRisesWithUtilRiskNavAndConcentration() public {
        (uint16 full, bool ok,) = pricing.feeBps(600, 0, false, 0, 10_000);
        assertTrue(ok);
        assertEq(full, 148);
        (uint16 risk, bool riskOk,) = pricing.feeBpsWithRisk(600, 0, false, 0, 0, 10_000);
        assertTrue(riskOk);
        assertEq(risk, 148);

        (uint16 aged, bool ageOk,) = pricing.feeBps(600, 7 days, false, 0, 0);
        assertTrue(ageOk);
        assertEq(aged, 123);
        (uint16 atWarn,,) = pricing.feeBps(600, 1 days, false, 0, 0);
        assertEq(atWarn, 99);

        IPricingEngine.Params memory p = pricing.params();
        p.concentrationMaxPremiumAprBps = 200;
        vm.prank(owner);
        pricing.setParams(p);
        (uint16 conc, bool concOk,) = pricing.feeBps(600, 0, false, 10_000, 0);
        assertTrue(concOk);
        assertEq(conc, 115);
    }

    function test_refusesAboveMaxAndStaleBoundary() public view {
        (uint16 bps, bool ok, string memory why) = pricing.feeBps(90 days, 0, false, 0, 0);
        assertFalse(ok);
        assertEq(why, "fee above max");
        assertEq(bps, 1500);

        (bps, ok, why) = pricing.feeBps(600, 7 days, false, 0, 0);
        assertTrue(ok);
        assertEq(why, "");
        assertEq(bps, 123);
        (bps, ok, why) = pricing.feeBps(600, 7 days + 1, false, 0, 0);
        assertFalse(ok);
        assertEq(why, "stale nav");
        assertEq(bps, 0);

        (bps, ok, why) = pricing.feeBps(600, 0, true, 0, 0);
        assertFalse(ok);
        assertEq(bps, 0);
        assertEq(why, "gated");
        (bps, ok, why) = pricing.feeBps(366 days + 1, 0, false, 0, 0);
        assertFalse(ok);
        assertEq(bps, 0);
        assertEq(why, "tenor");
    }

    function test_realNinetyDayWindowAtScaleOne() public {
        IPricingEngine.Params memory p = pricing.params();
        p.timeScale = 1;
        vm.prank(owner);
        pricing.setParams(p);
        (uint16 bps, bool ok,) = pricing.feeBps(90 days, 0, false, 0, 0);
        assertTrue(ok);
        assertEq(bps, 296);
    }

    function test_validateStageTwoBand() public view {
        (bool ok, string memory why) = pricing.validate(99, 600, 0, false, 0, 0, 0);
        assertTrue(ok);
        assertEq(why, "");
        (ok, why) = pricing.validate(100, 600, 0, false, 0, 0, 0);
        assertTrue(ok);
        assertEq(why, "");
        (ok, why) = pricing.validate(98, 600, 0, false, 0, 0, 0);
        assertFalse(ok);
        assertEq(why, "below model");
        (ok, why) = pricing.validate(1501, 600, 0, false, 0, 0, 0);
        assertFalse(ok);
        assertEq(why, "above max");
        (ok, why) = pricing.validate(99, 600, 0, true, 0, 0, 0);
        assertFalse(ok);
        assertEq(why, "gated");
    }

    function test_setParamsGuards() public {
        IPricingEngine.Params memory p = pricing.params();
        p.aprAtKinkBps = 100;
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(PricingEngine.BadParams.selector, "curve"));
        pricing.setParams(p);

        p = pricing.params();
        p.kinkUtilBps = 0;
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(PricingEngine.BadParams.selector, "kink"));
        pricing.setParams(p);

        p = pricing.params();
        p.timeScale = 0;
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(PricingEngine.BadParams.selector, "scale"));
        pricing.setParams(p);

        p = pricing.params();
        p.yearSeconds = 1;
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(PricingEngine.BadParams.selector, "year"));
        pricing.setParams(p);

        IPricingEngine.Params memory current = pricing.params();
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger));
        pricing.setParams(current);
    }

    function testFuzz_timeAndUtilMonotone(uint32 lo, uint32 hi, uint16 utilLo, uint16 utilHi) public view {
        // 9128s is the last default quote at or under 1500 bps. 9129 quotes "fee above max".
        uint256 open = 9128;
        lo = uint32(bound(lo, 0, open));
        hi = uint32(bound(hi, lo, open));
        (uint16 a, bool aOk, string memory aWhy) = pricing.feeBps(lo, 0, false, 0, 0);
        (uint16 b, bool bOk, string memory bWhy) = pricing.feeBps(hi, 0, false, 0, 0);
        assertTrue(aOk, aWhy);
        assertTrue(bOk, bWhy);
        assertGe(b, a);

        utilLo = uint16(bound(utilLo, 0, 10_000));
        utilHi = uint16(bound(utilHi, utilLo, 10_000));
        (a, aOk, aWhy) = pricing.feeBps(600, 0, false, 0, utilLo);
        (b, bOk, bWhy) = pricing.feeBps(600, 0, false, 0, utilHi);
        assertTrue(aOk, aWhy);
        assertTrue(bOk, bWhy);
        assertGe(b, a);
    }
}
