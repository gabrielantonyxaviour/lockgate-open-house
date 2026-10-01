// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {PartnerVault} from "../../src/partner/PartnerVault.sol";

/// @notice Upgrade target. Storage layout stays the parent's. Only the version changes.
contract PartnerVaultV2 is PartnerVault {
    function vaultVersion() external pure override returns (uint256) {
        return 2;
    }
}
