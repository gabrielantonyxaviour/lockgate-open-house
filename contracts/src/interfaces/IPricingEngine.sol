// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice On-chain fee guardrails for stage 1 draws and for stage 2 proposals.
/// @dev The day count is ACT/365 (31_536_000 seconds), the same constant the off-chain engine uses.
///      A 10-minute demo wait at timeScale 4320 is 30 priced days and prices at 99 bps on a 12% base APR
///      before premiums (about 1%). Fees above `maxFeeBps` are refused, not clamped.
interface IPricingEngine {
    struct Params {
        uint16 baseAprBps;
        uint16 kinkUtilBps;
        uint16 aprAtKinkBps;
        uint16 aprAtFullBps;
        uint16 minFeeBps;
        uint16 maxFeeBps;
        uint32 timeScale;
        uint16 maxRiskPremiumAprBps;
        uint64 navWarnSeconds;
        uint64 maxNavAge;
        uint16 navAgeMaxPremiumAprBps;
        uint16 concentrationCapBps;
        uint16 concentrationMaxPremiumAprBps;
        uint64 maxTenorSeconds;
        uint64 yearSeconds;
    }

    /// @notice Live curve. `setParams` replaces it. An open advance keeps the fee stored at draw.
    function params() external view returns (Params memory);

    /// @notice Owner. Replaces the live curve. An open advance keeps the fee, principal, due date, and grace stored at draw.
    function setParams(Params calldata next) external;

    /// @notice SPEC quote. `platformRiskBps` is treated as zero. Premium inputs are 0–10_000.
    function feeBps(uint256 secondsToWindow, uint256 navAge, bool gated, uint16 exposureBps, uint16 utilizationBps)
        external
        view
        returns (uint16 bps, bool available, string memory reason);

    /// @notice Same model as `feeBpsWithRisk`. Code 0 is available. 4 gated, 13 stale nav, 14 tenor, 15 fee above max.
    function feeCode(
        uint256 secondsToWindow,
        uint256 navAge,
        bool gated,
        uint16 exposureBps,
        uint16 utilizationBps,
        uint16 platformRiskBps
    ) external view returns (uint16 bps, uint8 code);

    /// @notice Same model with a platform risk score. 0 is no extra APR. 10_000 is the full risk premium.
    function feeBpsWithRisk(
        uint256 secondsToWindow,
        uint256 navAge,
        bool gated,
        uint16 exposureBps,
        uint16 utilizationBps,
        uint16 platformRiskBps
    ) external view returns (uint16 bps, bool available, string memory reason);

    /// @notice Stage 2 guard. The proposal may charge more than the model, never less, and never above the max.
    ///         Unavailable model quotes (gated, stale, tenor, fee above max) reject the proposal.
    function validate(
        uint16 proposedBps,
        uint256 secondsToWindow,
        uint256 navAge,
        bool gated,
        uint16 exposureBps,
        uint16 utilizationBps,
        uint16 platformRiskBps
    ) external view returns (bool ok, string memory reason);

    /// @notice Lender-favorable token fee. Rounds up. Reverts when that fee does not fit in uint256.
    ///         Callers must reject `fee >= navValue`.
    function feeFromBps(uint256 navValue, uint16 bps) external pure returns (uint256);
}
