// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {UsdgAdapter} from "../../src/core/UsdgAdapter.sol";
import {PricingEngine} from "../../src/core/PricingEngine.sol";
import {PlatformReserve} from "../../src/core/PlatformReserve.sol";
import {LockgateCreditLine} from "../../src/core/LockgateCreditLine.sol";
import {CreditActor} from "./mocks/CreditActor.sol";
import {CallbackUsdg} from "./mocks/CallbackUsdg.sol";

/// @notice A token callback cannot draw twice, and a short transfer cannot repay.
contract Reenter is Test {
    uint256 internal constant U = 1e6;
    uint256 internal constant NAV = 10_000 * U;
    bytes4 internal constant REENTER = bytes4(keccak256("ReentrancyGuardReentrantCall()"));
    bytes4 internal constant SHORT = bytes4(keccak256("FeeOnTransfer(uint256,uint256)"));

    CallbackUsdg internal token;
    LockgateCreditLine internal line;
    CreditActor internal actor;

    function setUp() public {
        token = new CallbackUsdg();
        UsdgAdapter adapter = new UsdgAdapter(address(token), true);
        PricingEngine pricing = new PricingEngine(address(this));
        PlatformReserve reserve = new PlatformReserve(address(this), address(adapter));
        line = new LockgateCreditLine(address(this), address(adapter), address(pricing), address(reserve));
        reserve.setCreditLine(address(line));
        reserve.setSlasher(address(line), true);
        actor = new CreditActor(line, IERC20(address(token)), makeAddr("investor"));
        line.registerSource(address(actor), 1_000_000 * U, 750);
        token.mint(address(this), 200_000 * U);
        token.approve(address(line), type(uint256).max);
        line.depositCapital(200_000 * U);
        token.mint(address(actor), 20_000 * U);
        actor.postReserve(20_000 * U);
        actor.refresh(600);
    }

    function test_callbackDuringPayoutCannotDrawAgain() public {
        token.arm(address(actor), NAV);
        vm.expectRevert(REENTER);
        actor.draw(NAV);
        assertEq(line.advanceCount(), 0);
        assertEq(line.outstanding(), 0);
        assertEq(token.balanceOf(actor.investor()), 0);
    }

    function test_shortTransferDoesNotRepay() public {
        (uint256 id, uint256 fee) = actor.draw(NAV);
        uint256 outstanding = line.outstanding();
        token.mint(address(actor), NAV);
        token.setShortfall(1);
        vm.expectRevert(abi.encodeWithSelector(SHORT, NAV, NAV - 1));
        actor.repay(id);
        assertEq(line.outstanding(), outstanding);
        assertEq(line.earnedFees(), 0);
        assertEq(line.remainingOf(id), NAV);
        assertGt(fee, 0);
    }
}
