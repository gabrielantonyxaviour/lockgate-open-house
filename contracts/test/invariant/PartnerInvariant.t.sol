// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {Advance, AdvanceStatus} from "../../src/partner/Types.sol";
import {PartnerHandler} from "./PartnerHandler.sol";
import {PartnerVault} from "../../src/partner/PartnerVault.sol";

/// @notice Partner cash identity. Lockgate's balance stays 0. Repayments do not stick to the router.
contract PartnerInvariant is Test {
    PartnerHandler internal handler;

    function setUp() public {
        handler = new PartnerHandler();
        bytes4[] memory selectors = new bytes4[](7);
        selectors[0] = handler.fund.selector;
        selectors[1] = handler.repay.selector;
        selectors[2] = handler.partnerWithdraw.selector;
        selectors[3] = handler.lockgatePull.selector;
        selectors[4] = handler.fundOutsider.selector;
        selectors[5] = handler.fundLockgateAsRecipient.selector;
        selectors[6] = handler.skimDonation.selector;
        targetSelector(FuzzSelector({addr: address(handler), selectors: selectors}));
        targetContract(address(handler));
    }

    /// forge-config: default.invariant.runs = 64
    /// forge-config: default.invariant.depth = 40
    function invariant_cashStaysWithThePartner() public view {
        PartnerVault vault = handler.vault();
        uint256 idle = vault.idle();
        uint256 reserve = vault.reserveCash();
        uint256 outstanding = vault.outstandingPrincipal();
        assertEq(handler.breached(), 0, "lockgate moved funds");
        assertEq(handler.token().balanceOf(address(vault)), idle + reserve, "cash");
        assertEq(handler.token().balanceOf(address(vault)) + outstanding, vault.totalAssets() + reserve, "assets");
        assertEq(handler.token().balanceOf(handler.lockgate()), 0, "lockgate");
        assertEq(handler.token().balanceOf(address(handler.router())), 0, "router");
        assertEq(handler.token().balanceOf(handler.platform()), handler.paidOut(), "platform");

        uint256 principals;
        uint256 exposure;
        uint256 n = vault.advanceCount();
        for (uint256 id = 1; id <= n; id++) {
            Advance memory advance = vault.getAdvance(id);
            assertEq(advance.principalRemaining + advance.feeRemaining, advance.owed, "owed");
            principals += advance.principalRemaining;
            if (advance.status == AdvanceStatus.Active || advance.status == AdvanceStatus.Late) {
                exposure += advance.owed;
            }
        }
        assertEq(principals, outstanding, "principal");
        assertEq(exposure, vault.exposureOf(handler.platform()), "exposure");
    }
}
