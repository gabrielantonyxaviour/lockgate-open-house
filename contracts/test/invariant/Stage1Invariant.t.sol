// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ILockgateCreditLine} from "../../src/interfaces/ILockgateCreditLine.sol";
import {LockgateCreditLine} from "../../src/core/LockgateCreditLine.sol";
import {Stage1Handler} from "./Stage1Handler.sol";

/// @notice Solvency, fee bounds, and repay-first on the stage-1 book.
contract Stage1Invariant is Test {
    Stage1Handler internal handler;

    function setUp() public {
        handler = new Stage1Handler();
        bytes4[] memory selectors = new bytes4[](5);
        selectors[0] = handler.draw.selector;
        selectors[1] = handler.repay.selector;
        selectors[2] = handler.markLate.selector;
        selectors[3] = handler.drawWhileGated.selector;
        selectors[4] = handler.drawOnStaleNav.selector;
        targetSelector(FuzzSelector({addr: address(handler), selectors: selectors}));
        targetContract(address(handler));
    }

    function invariant_solvencyFeeBoundsAndRepayFirst() public view {
        LockgateCreditLine line = handler.line();
        assertEq(line.accountedAssets(), line.accountedEquity(), "assets");
        assertEq(handler.reserve().tokenBalance(), handler.reserve().totalBalances(), "reserve");
        assertEq(IERC20(line.token()).balanceOf(handler.investorA()), handler.paidA(), "investor A");
        assertEq(IERC20(line.token()).balanceOf(handler.investorB()), handler.paidB(), "investor B");

        uint256 unpaidPrincipal;
        uint256 exposureLeft;
        uint256 n = line.advanceCount();
        for (uint256 id = 1; id <= n; id++) {
            ILockgateCreditLine.Advance memory advance = line.getAdvance(id);
            uint256 nav = advance.principal + advance.fee;
            uint256 recovered = line.recoveredOf(id);
            if (nav > recovered) exposureLeft += nav - recovered;
            if (recovered < advance.principal) unpaidPrincipal += advance.principal - recovered;
            assertLt(advance.fee, nav, "fee consumes nav");
            assertGe(advance.fee * 10_000, nav * 25, "below 25 bps");
            assertLe(advance.fee, (nav * 1_500 + 9_999) / 10_000, "above 1500 bps");
            if (advance.status == ILockgateCreditLine.AdvanceStatus.Repaid) {
                assertEq(nav, recovered, "repaid still open");
            }
        }
        assertEq(unpaidPrincipal, line.outstanding(), "outstanding");
        assertEq(exposureLeft, line.totalExposure(), "exposure");
    }
}
