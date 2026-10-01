// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AdvanceProposal} from "../../../src/interfaces/IAdvanceProposal.sol";
import {PartnerVault} from "../../../src/partner/PartnerVault.sol";

/// @notice Approved platform that tries to take a second payment from inside the token transfer.
contract ReenterPlatform {
    PartnerVault public vault;
    bool public withdrew;
    bool public executed;
    bytes4 public withdrawSel;
    bytes4 public executeSel;

    function arm(address next) external {
        vault = PartnerVault(next);
    }

    function onTokens() external {
        try vault.withdraw(1, address(this)) {
            withdrew = true;
        } catch (bytes memory err) {
            withdrawSel = _sel(err);
        }
        AdvanceProposal memory blank;
        try vault.execute(blank, "", "") {
            executed = true;
        } catch (bytes memory err) {
            executeSel = _sel(err);
        }
    }

    function gated() external pure returns (bool) {
        return false;
    }

    function navUpdatedAt() external view returns (uint64) {
        return uint64(block.timestamp);
    }

    function _sel(bytes memory err) private pure returns (bytes4 sel) {
        if (err.length < 4) return bytes4(0);
        assembly {
            sel := mload(add(err, 32))
        }
    }
}
