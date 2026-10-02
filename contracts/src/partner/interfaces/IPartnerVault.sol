// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AdvanceProposal} from "../../interfaces/IAdvanceProposal.sol";
import {Advance, MandateView, PlatformConfig, RejectReason} from "../Types.sol";

/// @title IPartnerVault
/// @notice Partner-owned exit vault. Lockgate's engine may be the proposer; it cannot move funds.
interface IPartnerVault {
    /// @notice Partner who can move cash and set terms.
    function owner() external view returns (address);
    /// @notice Token the vault holds.
    function asset() external view returns (address);
    /// @notice Address whose signature must match the engine digest.
    function proposer() external view returns (address);
    /// @notice Extra partner signer. Address zero means the owner signs.
    function partnerSigner() external view returns (address);
    /// @notice Module that may authorise an execute. Address zero means none.
    function autoModule() external view returns (address);
    /// @notice When true, a new advance is rejected. Repayment still runs.
    function paused() external view returns (bool);
    /// @notice Cash the owner can withdraw. Outstanding advances are not included.
    function idle() external view returns (uint256);
    /// @notice First-loss cash posted across platforms.
    function reserveCash() external view returns (uint256);
    /// @notice Cash that has left the vault and is not yet back.
    function outstandingPrincipal() external view returns (uint256);
    /// @notice Idle cash plus outstanding principal. Posted reserves are not included.
    function totalAssets() external view returns (uint256);
    /// @notice Shares minted to the partner.
    function totalShares() external view returns (uint256);
    /// @notice Unpaid nav for this platform.
    function exposureOf(address platform) external view returns (uint256);
    /// @notice First-loss posted for this platform.
    function reserveOf(address platform) external view returns (uint256);
    /// @notice Fee floor, tenor cap, concentration, expiry, and the signer.
    function mandate() external view returns (MandateView memory);
    /// @notice Approval, limit, reserve rate, and gate for this platform.
    function platformConfig(address platform) external view returns (PlatformConfig memory);
    /// @notice Recipient that must match the proposal. Address zero means the platform itself.
    function payoutTo(address platform) external view returns (address);
    /// @notice Mandate result. `None` means the terms would fund.
    function preview(AdvanceProposal calldata proposal) external view returns (RejectReason);
    /// @notice Largest nav fundable at `max(feeBps, mandate minimum)` for this due time.
    function maxNav(address platform, uint16 feeBps, uint64 dueAt) external view returns (uint256);
    /// @notice Stored advance. An unknown id is an empty struct.
    function getAdvance(uint256 id) external view returns (Advance memory);
    /// @notice Grace stored when this advance was funded.
    function graceOf(uint256 advanceId) external view returns (uint64);
    /// @notice Amount still owed. Zero when the id is unknown or already cleared.
    function owedOf(uint256 id) external view returns (uint256);
    /// @notice Number of advances funded. Cancelled nonces are not included.
    function advanceCount() external view returns (uint256);
    /// @notice True after execute, approve, or cancel of this nonce.
    function nonceUsed(uint256 nonce) external view returns (bool);
    /// @notice Engine digest filed for this nonce. Zero means none is filed.
    function proposalHashOf(uint256 nonce) external view returns (bytes32);
    /// @notice Engine digest for this vault. Domain `LockgateAdvance`, version `1`.
    function hashTypedProposal(AdvanceProposal calldata proposal) external view returns (bytes32);

    /// @notice Store the engine digest. Moves no tokens.
    function submitProposal(AdvanceProposal calldata proposal, bytes calldata proposerSignature)
        external
        returns (bytes32 digest);

    /// @notice Pay the platform when the engine digest and a partner authorisation both match.
    function execute(AdvanceProposal calldata proposal, bytes calldata engineSig, bytes calldata partnerSig)
        external
        returns (uint256 advanceId);

    /// @notice Pull the full amount still owed.
    function repay(uint256 advanceId) external;

    /// @notice Slash reserve after `dueAt` plus the grace stored at funding.
    function markLate(uint256 advanceId) external;
}
