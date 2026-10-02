// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {FacilityMath} from "../../src/facility/libraries/FacilityMath.sol";
import {FlowHandler} from "./FlowHandler.sol";

/// @notice One token moves through stage 1, stage 2, and stage 3 in a random order.
contract FlowConservation is Test {
    FlowHandler internal handler;

    function setUp() public {
        handler = new FlowHandler();
        bytes4[] memory selectors = new bytes4[](8);
        selectors[0] = handler.stage1Draw.selector;
        selectors[1] = handler.stage1Repay.selector;
        selectors[2] = handler.stage2Fund.selector;
        selectors[3] = handler.stage2Repay.selector;
        selectors[4] = handler.stage2Withdraw.selector;
        selectors[5] = handler.stage3Draw.selector;
        selectors[6] = handler.stage3Repay.selector;
        selectors[7] = handler.stage3Redeem.selector;
        targetSelector(FuzzSelector({addr: address(handler), selectors: selectors}));
        targetContract(address(handler));
    }

    /// forge-config: default.invariant.runs = 32
    /// forge-config: default.invariant.depth = 20
    function invariant_fundsAreConserved() public view {
        assertEq(handler.failures(), 0, "lockgate received a token");
        assertEq(handler.held(), handler.token().totalSupply(), "supply");
        assertEq(handler.line().accountedAssets(), handler.line().accountedEquity(), "stage1");
        assertEq(handler.reserve().tokenBalance(), handler.reserve().totalBalances(), "reserve");
        assertEq(
            handler.token().balanceOf(address(handler.vault())),
            handler.vault().idle() + handler.vault().reserveCash(),
            "stage2"
        );
        assertEq(handler.token().balanceOf(handler.lockgate()), 0, "lockgate");
        FacilityMath.State memory books = handler.facility().accounting();
        assertEq(handler.token().balanceOf(address(handler.facility())), books.cash, "stage3 cash");
        assertTrue(handler.facility().solvent(), "stage3");
    }
}
