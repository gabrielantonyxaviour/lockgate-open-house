// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IPricingEngine} from "../interfaces/IPricingEngine.sol";
import {PricingMath} from "./PricingMath.sol";

/// @title PricingEngine
/// @notice On-chain guardrails. Stage 1 charges this quote. Stage 2 may charge more, never less, and never past the max.
contract PricingEngine is Ownable, IPricingEngine {
    /// @notice Live curve stored by `setParams`. `params()` returns this.
    Params public stored;

    error BadParams(string reason);

    event ParamsUpdated(Params params);

    constructor(address owner_) Ownable(owner_) {
        Params memory initial = Params({
            baseAprBps: 1200,
            kinkUtilBps: 6667,
            aprAtKinkBps: 1200,
            aprAtFullBps: 1800,
            minFeeBps: 25,
            maxFeeBps: 1500,
            timeScale: 4320,
            maxRiskPremiumAprBps: 600,
            navWarnSeconds: 1 days,
            maxNavAge: 7 days,
            navAgeMaxPremiumAprBps: 300,
            concentrationCapBps: 10_000,
            concentrationMaxPremiumAprBps: 0,
            maxTenorSeconds: 366 days,
            yearSeconds: 31_536_000
        });
        stored = initial;
        emit ParamsUpdated(initial);
    }

    /// @inheritdoc IPricingEngine
    function params() external view returns (Params memory) {
        return stored;
    }

    /// @inheritdoc IPricingEngine
    function setParams(Params calldata next) external onlyOwner {
        if (next.aprAtKinkBps < next.baseAprBps || next.aprAtFullBps < next.aprAtKinkBps) revert BadParams("curve");
        if (next.kinkUtilBps == 0 || next.kinkUtilBps >= 10_000) revert BadParams("kink");
        if (next.minFeeBps > next.maxFeeBps || next.maxFeeBps > 10_000) revert BadParams("fee");
        if (next.timeScale == 0 || next.timeScale > 1_000_000) revert BadParams("scale");
        if (next.maxNavAge == 0 || next.navWarnSeconds > next.maxNavAge) revert BadParams("nav");
        if (next.concentrationCapBps == 0 || next.concentrationCapBps > 10_000) revert BadParams("concentration");
        if (next.yearSeconds < 360 days || next.yearSeconds > 366 days) revert BadParams("year");
        if (next.maxTenorSeconds == 0) revert BadParams("tenor");
        stored = next;
        emit ParamsUpdated(next);
    }

    /// @inheritdoc IPricingEngine
    function feeBps(uint256 secondsToWindow, uint256 navAge, bool gated, uint16 exposureBps, uint16 utilizationBps)
        external
        view
        returns (uint16 bps, bool available, string memory reason)
    {
        return PricingMath.quote(stored, secondsToWindow, navAge, gated, exposureBps, utilizationBps, 0);
    }

    /// @inheritdoc IPricingEngine
    function feeCode(
        uint256 secondsToWindow,
        uint256 navAge,
        bool gated,
        uint16 exposureBps,
        uint16 utilizationBps,
        uint16 platformRiskBps
    ) external view returns (uint16 bps, uint8 code) {
        return PricingMath.quoteCode(stored, secondsToWindow, navAge, gated, exposureBps, utilizationBps, platformRiskBps);
    }

    /// @inheritdoc IPricingEngine
    function feeBpsWithRisk(
        uint256 secondsToWindow,
        uint256 navAge,
        bool gated,
        uint16 exposureBps,
        uint16 utilizationBps,
        uint16 platformRiskBps
    ) external view returns (uint16 bps, bool available, string memory reason) {
        return PricingMath.quote(stored, secondsToWindow, navAge, gated, exposureBps, utilizationBps, platformRiskBps);
    }

    /// @inheritdoc IPricingEngine
    function validate(
        uint16 proposedBps,
        uint256 secondsToWindow,
        uint256 navAge,
        bool gated,
        uint16 exposureBps,
        uint16 utilizationBps,
        uint16 platformRiskBps
    ) external view returns (bool ok, string memory reason) {
        (uint16 model, bool available, string memory why) =
            PricingMath.quote(stored, secondsToWindow, navAge, gated, exposureBps, utilizationBps, platformRiskBps);
        if (!available) return (false, why);
        if (proposedBps < model) return (false, "below model");
        if (proposedBps > stored.maxFeeBps) return (false, "above max");
        return (true, "");
    }

    /// @inheritdoc IPricingEngine
    function feeFromBps(uint256 navValue, uint16 bps) external pure returns (uint256) {
        return PricingMath.feeFromBps(navValue, bps);
    }
}
