// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AdvanceProposal} from "../../interfaces/IAdvanceProposal.sol";
import {Advance, MandateView, PlatformConfig, RejectReason} from "../Types.sol";

/// @title IPartnerVault
/// @notice Partner-owned exit vault. Lockgate's engine may be the proposer; it cannot move funds.
interface IPartnerVault {
    function owner() external view returns (address);
    function asset() external view returns (address);
    function proposer() external view returns (address);
    function partnerSigner() external view returns (address);
    function autoModule() external view returns (address);
    function paused() external view returns (bool);
    function idle() external view returns (uint256);
    function reserveCash() external view returns (uint256);
    function outstandingPrincipal() external view returns (uint256);
    function totalAssets() external view returns (uint256);
    function totalShares() external view returns (uint256);
    function exposureOf(address platform) external view returns (uint256);
    function reserveOf(address platform) external view returns (uint256);
    function mandate() external view returns (MandateView memory);
    function platformConfig(address platform) external view returns (PlatformConfig memory);
    function preview(AdvanceProposal calldata proposal) external view returns (RejectReason);
    function maxNav(address platform, uint16 feeBps, uint64 dueAt) external view returns (uint256);
    function getAdvance(uint256 id) external view returns (Advance memory);
    function owedOf(uint256 id) external view returns (uint256);
    function advanceCount() external view returns (uint256);
    function nonceUsed(uint256 nonce) external view returns (bool);
    function proposalHashOf(uint256 nonce) external view returns (bytes32);
    function hashTypedProposal(AdvanceProposal calldata proposal) external view returns (bytes32);

    function submitProposal(AdvanceProposal calldata proposal, bytes calldata proposerSignature)
        external
        returns (bytes32 digest);

    function execute(AdvanceProposal calldata proposal, bytes calldata engineSig, bytes calldata partnerSig)
        external
        returns (uint256 advanceId);

    function repay(uint256 advanceId) external;
    function markLate(uint256 advanceId) external;
}
