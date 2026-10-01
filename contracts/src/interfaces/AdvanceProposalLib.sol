// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AdvanceProposal} from "./IAdvanceProposal.sol";

/// @notice Hash helper shared by the off-chain engine (G8) and partner vaults (G7).
library AdvanceProposalLib {
    bytes32 internal constant TYPEHASH = keccak256(
        "AdvanceProposal(address platform,address recipient,uint256 requestId,uint256 navValue,uint256 fee,uint256 payout,uint16 feeBps,uint64 dueAt,uint64 expiresAt,uint256 nonce,bytes32 quoteId)"
    );
    bytes32 internal constant DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
    bytes32 internal constant NAME_HASH = keccak256("LockgateAdvance");
    bytes32 internal constant VERSION_HASH = keccak256("1");

    function hashStruct(AdvanceProposal memory proposal) internal pure returns (bytes32) {
        return keccak256(
            abi.encode(
                TYPEHASH,
                proposal.platform,
                proposal.recipient,
                proposal.requestId,
                proposal.navValue,
                proposal.fee,
                proposal.payout,
                proposal.feeBps,
                proposal.dueAt,
                proposal.expiresAt,
                proposal.nonce,
                proposal.quoteId
            )
        );
    }

    function domainSeparator(uint256 chainId, address verifyingContract) internal pure returns (bytes32) {
        return keccak256(abi.encode(DOMAIN_TYPEHASH, NAME_HASH, VERSION_HASH, chainId, verifyingContract));
    }

    function digest(AdvanceProposal memory proposal, uint256 chainId, address verifyingContract)
        internal
        pure
        returns (bytes32)
    {
        return keccak256(abi.encodePacked("\x19\x01", domainSeparator(chainId, verifyingContract), hashStruct(proposal)));
    }

    /// @notice Matches `makeQuoteId` in engine/src/proposal/typed.ts. `kind` is the QueueKind numeric code.
    function quoteId(
        address platform,
        uint256 navValue,
        uint256 fee,
        uint64 dueAt,
        uint16 riskBps,
        uint16 utilizationBps,
        uint64 navUpdatedAt,
        uint8 kind
    ) internal pure returns (bytes32) {
        return keccak256(abi.encode(platform, navValue, fee, dueAt, riskBps, utilizationBps, navUpdatedAt, kind));
    }
}
