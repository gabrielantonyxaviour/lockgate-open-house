// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {IPricingEngine} from "../interfaces/IPricingEngine.sol";

/// @notice Fee curve shared with the off-chain engine's shape: utilization APR, then additive premiums, ACT/365.
library PricingMath {
    uint256 internal constant BPS = 10_000;

    function feeFromBps(uint256 navValue, uint16 bps) internal pure returns (uint256) {
        return Math.mulDiv(navValue, bps, BPS, Math.Rounding.Ceil);
    }

    /// @dev Half away from zero, matching engine/src/money.ts `mulDivRoundHalfUp` for the APR and bps steps.
    function halfUp(uint256 x, uint256 y, uint256 den) internal pure returns (uint256) {
        if (x == 0 || y == 0) return 0;
        return (x * y + den / 2) / den;
    }

    function lerp(uint256 start, uint256 end, uint256 num, uint256 den) internal pure returns (uint256) {
        if (num == 0 || den == 0) return start;
        if (num >= den) return end;
        return start + halfUp(end - start, num, den);
    }

    function utilizationApr(uint16 utilizationBps, IPricingEngine.Params memory p) internal pure returns (uint256) {
        uint256 util = utilizationBps > BPS ? BPS : utilizationBps;
        if (util <= p.kinkUtilBps) return lerp(p.baseAprBps, p.aprAtKinkBps, util, p.kinkUtilBps);
        return lerp(p.aprAtKinkBps, p.aprAtFullBps, util - p.kinkUtilBps, BPS - p.kinkUtilBps);
    }

    function quote(
        IPricingEngine.Params memory p,
        uint256 secondsToWindow,
        uint256 navAge,
        bool gated,
        uint16 exposureBps,
        uint16 utilizationBps,
        uint16 platformRiskBps
    ) internal pure returns (uint16 bps, bool available, string memory reason) {
        uint8 code;
        (bps, code) = quoteCode(p, secondsToWindow, navAge, gated, exposureBps, utilizationBps, platformRiskBps);
        available = code == 0;
        reason = _reason(code);
    }

    function quoteCode(
        IPricingEngine.Params memory p,
        uint256 secondsToWindow,
        uint256 navAge,
        bool gated,
        uint16 exposureBps,
        uint16 utilizationBps,
        uint16 platformRiskBps
    ) internal pure returns (uint16 bps, uint8 code) {
        if (gated) return (0, 4);
        if (navAge > p.maxNavAge) return (0, 13);
        if (secondsToWindow > p.maxTenorSeconds) return (0, 14);
        uint256 raw = _rawFee(p, secondsToWindow, navAge, exposureBps, utilizationBps, platformRiskBps);
        if (raw > p.maxFeeBps) return (p.maxFeeBps, 15);
        if (raw < p.minFeeBps) raw = p.minFeeBps;
        return (uint16(raw), 0);
    }

    function _rawFee(
        IPricingEngine.Params memory p,
        uint256 secondsToWindow,
        uint256 navAge,
        uint16 exposureBps,
        uint16 utilizationBps,
        uint16 platformRiskBps
    ) private pure returns (uint256 raw) {
        uint256 totalApr = utilizationApr(utilizationBps, p);
        totalApr += _riskApr(p, platformRiskBps);
        totalApr += _navApr(p, navAge);
        totalApr += _concApr(p, exposureBps);
        if (totalApr == 0 || secondsToWindow == 0 || p.timeScale == 0) return 0;
        return halfUp(totalApr * secondsToWindow, p.timeScale, p.yearSeconds);
    }

    function _riskApr(IPricingEngine.Params memory p, uint16 platformRiskBps) private pure returns (uint256) {
        if (platformRiskBps == 0 || p.maxRiskPremiumAprBps == 0) return 0;
        uint256 risk = platformRiskBps > BPS ? BPS : platformRiskBps;
        return halfUp(risk, p.maxRiskPremiumAprBps, BPS);
    }

    function _navApr(IPricingEngine.Params memory p, uint256 navAge) private pure returns (uint256) {
        if (navAge <= p.navWarnSeconds || p.navAgeMaxPremiumAprBps == 0 || p.maxNavAge <= p.navWarnSeconds) return 0;
        return halfUp(p.navAgeMaxPremiumAprBps, navAge - p.navWarnSeconds, p.maxNavAge - p.navWarnSeconds);
    }

    function _concApr(IPricingEngine.Params memory p, uint16 exposureBps) private pure returns (uint256) {
        if (p.concentrationMaxPremiumAprBps == 0 || p.concentrationCapBps == 0 || exposureBps == 0) return 0;
        uint256 exposure = exposureBps > p.concentrationCapBps ? p.concentrationCapBps : exposureBps;
        return halfUp(exposure, p.concentrationMaxPremiumAprBps, p.concentrationCapBps);
    }

    function _reason(uint8 code) private pure returns (string memory) {
        if (code == 4) return "gated";
        if (code == 13) return "stale nav";
        if (code == 14) return "tenor";
        if (code == 15) return "fee above max";
        return "";
    }
}
