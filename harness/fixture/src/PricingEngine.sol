// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title PricingEngine
/// @notice Fixture quote. Parameters match SPEC.md (base 1200 bps APR, timeScale, min, max).
///         Premium shape above base × scaled wait is a fixture choice until G6 publishes one.
///         effectiveSeconds = secondsToWindow * timeScale. timeScale 4320 turns 10 demo minutes
///         into 30 days (SPEC.md). Fee bps = baseAprBps * effectiveSeconds / 365 days, plus
///         utilization and concentration premiums, clamped by min. Above max is unavailable.
contract PricingEngine {
    uint256 public constant YEAR = 365 days;

    uint16 public immutable baseAprBps;
    uint32 public immutable timeScale;
    uint16 public immutable minFeeBps;
    uint16 public immutable maxFeeBps;
    uint64 public immutable maxNavAge;

    error BadParams();

    constructor(uint16 baseAprBps_, uint32 timeScale_, uint16 minFeeBps_, uint16 maxFeeBps_, uint64 maxNavAge_) {
        if (minFeeBps_ > maxFeeBps_ || maxFeeBps_ > 10_000 || timeScale_ == 0 || maxNavAge_ == 0) revert BadParams();
        baseAprBps = baseAprBps_;
        timeScale = timeScale_;
        minFeeBps = minFeeBps_;
        maxFeeBps = maxFeeBps_;
        maxNavAge = maxNavAge_;
    }

    /// @param exposureBps platform exposure / its limit, in bps
    /// @param utilizationBps book outstanding / (outstanding + idle), in bps
    function feeBps(uint256 secondsToWindow, uint256 navAge, bool gated, uint16 exposureBps, uint16 utilizationBps)
        external
        view
        returns (uint16 bps, bool available, string memory reason)
    {
        if (gated) return (0, false, "gated");
        if (navAge > maxNavAge) return (0, false, "stale-nav");
        uint256 effective = secondsToWindow * uint256(timeScale);
        uint256 raw = (uint256(baseAprBps) * effective) / YEAR;
        if (utilizationBps > 6_500) raw += (uint256(utilizationBps) - 6_500) / 10;
        if (exposureBps > 3_000) raw += (uint256(exposureBps) - 3_000) / 10;
        if (raw > maxFeeBps) return (maxFeeBps, false, "above-max");
        if (raw < minFeeBps) raw = minFeeBps;
        bps = uint16(raw);
        available = true;
        reason = "";
    }
}
