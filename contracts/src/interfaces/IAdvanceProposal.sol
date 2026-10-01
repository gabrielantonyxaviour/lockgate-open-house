// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice EIP-712 advance proposal. Field order and domain match `engine/src/proposal/typed.ts`.
///         The vault is the verifying contract. It is not a field of the struct.
struct AdvanceProposal {
    address platform;
    address recipient;
    uint256 requestId;
    uint256 navValue;
    uint256 fee;
    uint256 payout;
    uint16 feeBps;
    uint64 dueAt;
    uint64 expiresAt;
    uint256 nonce;
    bytes32 quoteId;
}

interface IAdvanceProposal {
    function submitProposal(AdvanceProposal calldata proposal, bytes calldata proposerSignature) external;
}
