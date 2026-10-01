// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AdvanceProposal} from "../../interfaces/IAdvanceProposal.sol";
import {AdvanceProposalLib} from "../../interfaces/AdvanceProposalLib.sol";

/// @title AdvanceHash
/// @notice Vault-side view of the engine digest. Domain name `LockgateAdvance`, version `1`,
///         verifying contract = this vault. The type string lives in `AdvanceProposalLib`.
library AdvanceHash {
    function digest(AdvanceProposal memory proposal) internal view returns (bytes32) {
        return AdvanceProposalLib.digest(proposal, block.chainid, address(this));
    }
}
