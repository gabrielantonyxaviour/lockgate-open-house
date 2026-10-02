// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {IPricingEngine} from "../../src/interfaces/IPricingEngine.sol";
import {PricingEngine} from "../../src/core/PricingEngine.sol";
import {PricingMath} from "../../src/core/PricingMath.sol";

/// @notice PricingMath against an independent half-up and against the split product the engine uses.
contract PricingDiffFuzzTest is Test {
    uint256 internal constant BPS = 10_000;

    PricingEngine internal pricing;

    function setUp() public {
        pricing = new PricingEngine(address(this));
    }

    function extHalf(uint256 x, uint256 y, uint256 den) external pure returns (uint256) {
        return PricingMath.halfUp(x, y, den);
    }

    function extFee(uint256 nav, uint16 bps) external pure returns (uint256) {
        return PricingMath.feeFromBps(nav, bps);
    }

    function refHalf(uint256 x, uint256 y, uint256 den) external pure returns (uint256) {
        return _half(x, y, den);
    }

    function test_zeroDustMaxUintAndRoundingDirection() public view {
        assertEq(PricingMath.halfUp(0, type(uint256).max, 1), 0);
        assertEq(PricingMath.halfUp(type(uint256).max, 0, 1), 0);
        assertEq(PricingMath.halfUp(1, 1, 2), 1, "exact half rounds up");
        assertEq(PricingMath.halfUp(1, 1, 3), 0, "below half rounds down");
        assertEq(PricingMath.halfUp(2, 1, 3), 1, "above half rounds up");
        assertEq(PricingMath.halfUp(type(uint256).max, 2, 4), 1 << 255);
        assertEq(PricingMath.halfUp(type(uint256).max, type(uint256).max, type(uint256).max), type(uint256).max);
        assertEq(PricingMath.halfUp(type(uint256).max - 10, 1, 100), this.refHalf(type(uint256).max - 10, 1, 100));

        assertEq(PricingMath.feeFromBps(0, type(uint16).max), 0);
        assertEq(PricingMath.feeFromBps(type(uint256).max, 0), 0);
        assertEq(PricingMath.feeFromBps(1, 1), 1, "dust rounds up");
        assertEq(PricingMath.feeFromBps(type(uint256).max, 10_000), type(uint256).max);

        assertEq(PricingMath.feeFromBps(4999, 1), 1);
        assertEq(PricingMath.halfUp(4999, 1, BPS), 0, "ceil is one above half-up");
        assertEq(PricingMath.halfUp(5000, 1, BPS), 1, "tie agrees");
        assertEq(PricingMath.feeFromBps(5000, 1), 1);

        uint256 floor = type(uint256).max / BPS;
        uint256 rem = type(uint256).max % BPS;
        assertGt(rem, 0);
        assertEq(PricingMath.feeFromBps(type(uint256).max, 1), floor + 1);
        assertEq(PricingMath.feeFromBps(type(uint256).max, 9999), this.refHalf(type(uint256).max, 9999, BPS) + 1);
        assertEq(PricingMath.feeFromBps(type(uint256).max, 5000), this.refHalf(type(uint256).max, 5000, BPS));
    }

    function test_halfUpRevertsOnZeroDenominator() public {
        vm.expectRevert(abi.encodeWithSignature("Panic(uint256)", uint256(0x12)));
        this.extHalf(0, 0, 0);
        vm.expectRevert(abi.encodeWithSignature("Panic(uint256)", uint256(0x12)));
        this.extHalf(type(uint256).max, 1, 0);
    }

    function test_halfUpRevertsWhenTheRoundedQuotientDoesNotFit() public {
        vm.expectRevert(abi.encodeWithSignature("Panic(uint256)", uint256(0x11)));
        this.extHalf(type(uint256).max, type(uint256).max, 1);
    }

    function test_feeFromBpsRevertsWhenCeilDoesNotFit() public {
        vm.expectRevert(abi.encodeWithSignature("Panic(uint256)", uint256(0x11)));
        this.extFee(type(uint256).max, 10_001);
    }

    function testFuzz_halfUpMatchesWideReference(uint256 x, uint256 y, uint256 den) public {
        x = _edge(x);
        y = _edge(y);
        den = _edge(den);
        if (den == 0) {
            vm.expectRevert();
            this.extHalf(x, y, 0);
            return;
        }
        try this.refHalf(x, y, den) returns (uint256 expect) {
            assertEq(this.extHalf(x, y, den), expect);
            if (_naiveFits(x, y, den)) {
                uint256 naive = (x == 0 || y == 0) ? 0 : (x * y + den / 2) / den;
                assertEq(expect, naive);
            }
        } catch {
            vm.expectRevert();
            this.extHalf(x, y, den);
        }
    }

    function testFuzz_oneBpsRoundsAwayFromZero(uint256 nav) public pure {
        nav = _edge(nav);
        uint256 fee = PricingMath.feeFromBps(nav, 1);
        if (nav == 0) {
            assertEq(fee, 0);
            return;
        }
        assertEq(fee, nav / BPS + (nav % BPS == 0 ? 0 : 1));
        assertGt(fee, 0);
    }

    function testFuzz_ceilIsHalfUpOrOneMore(uint256 nav, uint16 bps) public pure {
        nav = _edge(nav);
        bps = _edgeBps(bps);
        uint256 ceilFee = PricingMath.feeFromBps(nav, bps);
        uint256 halfFee = PricingMath.halfUp(nav, bps, BPS);
        assertGe(ceilFee, halfFee);
        if (ceilFee != halfFee) assertEq(ceilFee, halfFee + 1);
        uint256 rem = mulmod(nav, bps, BPS);
        if (rem == 0 || rem * 2 >= BPS) assertEq(ceilFee, halfFee);
        else assertEq(ceilFee, halfFee + 1);
        if (bps != 0 && nav <= type(uint256).max / bps) {
            uint256 prod = nav * bps;
            if (prod <= type(uint256).max - (BPS - 1)) assertEq(ceilFee, (prod + BPS - 1) / BPS);
        }
    }

    function testFuzz_quoteMatchesSplitProduct(uint96 wait, uint64 age, uint16 util, uint16 risk, uint16 book) public view {
        IPricingEngine.Params memory p = pricing.params();
        wait = uint96(bound(wait, 0, 400 days));
        age = uint64(bound(age, 0, 30 days));
        _sameQuote(p, wait, age, false, book, util, risk);
        _sameQuote(p, 0, 0, false, 0, 0, 0);
        _sameQuote(p, 1, 1, false, 1, 1, 1);
        _sameQuote(p, 366 days, 7 days, false, 10_000, 10_000, 10_000);
        _sameQuote(p, 366 days + 1, 7 days + 1, true, type(uint16).max, type(uint16).max, type(uint16).max);
    }

    function testFuzz_legalCurveMatchesSplitProduct(
        uint256 seed,
        uint64 wait,
        uint64 age,
        uint16 util,
        uint16 risk,
        uint16 book
    ) public {
        IPricingEngine.Params memory p = _legal(seed);
        pricing.setParams(p);
        wait = uint64(bound(wait, 0, p.maxTenorSeconds));
        age = uint64(bound(age, 0, p.maxNavAge));
        _sameQuote(p, wait, age, false, book, util, risk);
        (uint16 live, uint8 liveCode) = pricing.feeCode(wait, age, false, book, util, risk);
        (uint16 expect, uint8 expectCode) = _refCode(p, wait, age, false, book, util, risk);
        assertEq(live, expect);
        assertEq(liveCode, expectCode);
        (uint16 noRisk,,) = pricing.feeBps(wait, age, false, book, util);
        (uint16 withZero,,) = pricing.feeBpsWithRisk(wait, age, false, book, util, 0);
        assertEq(noRisk, withZero);
    }

    function _sameQuote(
        IPricingEngine.Params memory p,
        uint256 wait,
        uint256 age,
        bool gated,
        uint16 book,
        uint16 util,
        uint16 risk
    ) internal pure {
        (uint16 bps, uint8 code) = PricingMath.quoteCode(p, wait, age, gated, book, util, risk);
        (uint16 expectBps, uint8 expectCode) = _refCode(p, wait, age, gated, book, util, risk);
        assertEq(bps, expectBps);
        assertEq(code, expectCode);
        (uint16 wrapped, bool ok, string memory why) = PricingMath.quote(p, wait, age, gated, book, util, risk);
        assertEq(wrapped, bps);
        assertEq(ok, code == 0);
        if (code == 4) assertEq(why, "gated");
        else if (code == 13) assertEq(why, "stale nav");
        else if (code == 14) assertEq(why, "tenor");
        else if (code == 15) assertEq(why, "fee above max");
        else assertEq(why, "");
    }

    function _refCode(
        IPricingEngine.Params memory p,
        uint256 wait,
        uint256 age,
        bool gated,
        uint16 book,
        uint16 util,
        uint16 risk
    ) internal pure returns (uint16 bps, uint8 code) {
        if (gated) return (0, 4);
        if (age > p.maxNavAge) return (0, 13);
        if (wait > p.maxTenorSeconds) return (0, 14);
        uint256 raw = _refRaw(p, wait, age, book, util, risk);
        if (raw > p.maxFeeBps) return (p.maxFeeBps, 15);
        if (raw < p.minFeeBps) raw = p.minFeeBps;
        return (uint16(raw), 0);
    }

    function _refRaw(
        IPricingEngine.Params memory p,
        uint256 wait,
        uint256 age,
        uint16 book,
        uint16 util,
        uint16 risk
    ) internal pure returns (uint256) {
        uint256 total = _refUtil(util, p) + _refRisk(risk, p) + _refNav(age, p) + _refConc(book, p);
        if (total == 0 || wait == 0 || p.timeScale == 0) return 0;
        return _half(total, wait * p.timeScale, p.yearSeconds);
    }

    function _refUtil(uint16 util, IPricingEngine.Params memory p) internal pure returns (uint256) {
        uint256 u = util > BPS ? BPS : util;
        if (u <= p.kinkUtilBps) {
            if (u == 0 || p.kinkUtilBps == 0) return p.baseAprBps;
            if (u >= p.kinkUtilBps) return p.aprAtKinkBps;
            return uint256(p.baseAprBps) + _half(p.aprAtKinkBps - p.baseAprBps, u, p.kinkUtilBps);
        }
        uint256 span = BPS - p.kinkUtilBps;
        uint256 num = u - p.kinkUtilBps;
        if (num >= span) return p.aprAtFullBps;
        return uint256(p.aprAtKinkBps) + _half(p.aprAtFullBps - p.aprAtKinkBps, num, span);
    }

    function _refRisk(uint16 risk, IPricingEngine.Params memory p) internal pure returns (uint256) {
        if (risk == 0 || p.maxRiskPremiumAprBps == 0) return 0;
        uint256 r = risk > BPS ? BPS : risk;
        return _half(r, p.maxRiskPremiumAprBps, BPS);
    }

    function _refNav(uint256 age, IPricingEngine.Params memory p) internal pure returns (uint256) {
        if (age <= p.navWarnSeconds || p.navAgeMaxPremiumAprBps == 0 || p.maxNavAge <= p.navWarnSeconds) return 0;
        return _half(p.navAgeMaxPremiumAprBps, age - p.navWarnSeconds, p.maxNavAge - p.navWarnSeconds);
    }

    function _refConc(uint16 book, IPricingEngine.Params memory p) internal pure returns (uint256) {
        if (p.concentrationMaxPremiumAprBps == 0 || p.concentrationCapBps == 0 || book == 0) return 0;
        uint256 exposure = book > p.concentrationCapBps ? p.concentrationCapBps : book;
        return _half(exposure, p.concentrationMaxPremiumAprBps, p.concentrationCapBps);
    }

    function _half(uint256 x, uint256 y, uint256 den) internal pure returns (uint256) {
        uint256 floor = Math.mulDiv(x, y, den);
        uint256 rem = mulmod(x, y, den);
        if (rem == 0) return floor;
        uint256 mid = den / 2;
        if (rem > mid || (den % 2 == 0 && rem == mid)) return floor + 1;
        return floor;
    }

    function _legal(uint256 seed) internal pure returns (IPricingEngine.Params memory p) {
        p.baseAprBps = uint16(bound(seed, 0, 5_000));
        p.aprAtKinkBps = uint16(bound(uint256(keccak256(abi.encode(seed, "kink"))), p.baseAprBps, 8_000));
        p.aprAtFullBps = uint16(bound(uint256(keccak256(abi.encode(seed, "full"))), p.aprAtKinkBps, 10_000));
        p.kinkUtilBps = uint16(bound(uint256(keccak256(abi.encode(seed, "util"))), 1, 9_999));
        p.minFeeBps = uint16(bound(uint256(keccak256(abi.encode(seed, "min"))), 0, 1_500));
        p.maxFeeBps = uint16(bound(uint256(keccak256(abi.encode(seed, "max"))), p.minFeeBps, 10_000));
        p.timeScale = uint32(bound(uint256(keccak256(abi.encode(seed, "scale"))), 1, 1_000_000));
        p.maxRiskPremiumAprBps = uint16(bound(uint256(keccak256(abi.encode(seed, "risk"))), 0, 2_000));
        p.navWarnSeconds = uint64(bound(uint256(keccak256(abi.encode(seed, "warn"))), 0, 7 days));
        uint256 ageFloor = p.navWarnSeconds == 0 ? 1 : p.navWarnSeconds;
        p.maxNavAge = uint64(bound(uint256(keccak256(abi.encode(seed, "age"))), ageFloor, 30 days));
        p.navAgeMaxPremiumAprBps = uint16(bound(uint256(keccak256(abi.encode(seed, "navp"))), 0, 1_000));
        p.concentrationCapBps = uint16(bound(uint256(keccak256(abi.encode(seed, "cap"))), 1, 10_000));
        p.concentrationMaxPremiumAprBps = uint16(bound(uint256(keccak256(abi.encode(seed, "conc"))), 0, 500));
        p.maxTenorSeconds = uint64(bound(uint256(keccak256(abi.encode(seed, "tenor"))), 1, 366 days));
        p.yearSeconds = 31_536_000;
    }

    function _edge(uint256 v) internal pure returns (uint256) {
        if (v % 16 != 0) return v;
        uint256 slot = (v / 16) % 6;
        if (slot == 0) return 0;
        if (slot == 1) return 1;
        if (slot == 2) return 2;
        if (slot == 3) return type(uint256).max;
        if (slot == 4) return type(uint256).max - 1;
        return type(uint256).max / 2;
    }

    function _edgeBps(uint16 bps) internal pure returns (uint16) {
        if (bps % 8 != 0) return uint16(bound(bps, 0, 10_000));
        uint256 slot = bps % 5;
        if (slot == 0) return 0;
        if (slot == 1) return 1;
        if (slot == 2) return 5_000;
        if (slot == 3) return 9_999;
        return 10_000;
    }

    function _naiveFits(uint256 x, uint256 y, uint256 den) internal pure returns (bool) {
        if (x == 0 || y == 0) return true;
        if (x > type(uint256).max / y) return false;
        return x * y <= type(uint256).max - den / 2;
    }
}
