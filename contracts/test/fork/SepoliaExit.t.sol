// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {UsdgAdapter} from "../../src/core/UsdgAdapter.sol";
import {PricingEngine} from "../../src/core/PricingEngine.sol";
import {PlatformReserve} from "../../src/core/PlatformReserve.sol";
import {CreditLineAdmin} from "../../src/core/CreditLineAdmin.sol";
import {LockgateCreditLine} from "../../src/core/LockgateCreditLine.sol";
import {CreditActor} from "../invariant/mocks/CreditActor.sol";

/// @notice Stage-1 exit on a local fork of Arbitrum Sepolia USDG. Contracts are deployed
///         on the fork. Nothing is broadcast. The token is the canonical Sepolia proxy.
///         RPC: https://sepolia-rollup.arbitrum.io/rpc
///         Token: https://sepolia.arbiscan.io/token/0xFFC95faa3d63Cde504a05B567C600B78C0b41892
contract SepoliaExit is Test {
    using SafeERC20 for IERC20;

    address internal constant USDG = 0xFFC95faa3d63Cde504a05B567C600B78C0b41892;
    uint256 internal constant U = 1e6;
    uint256 internal constant NAV = 10_000 * U;

    IERC20 internal token;
    UsdgAdapter internal adapter;
    LockgateCreditLine internal line;
    CreditActor internal actor;
    address internal investor;
    address internal stranger = makeAddr("stranger");

    function setUp() public {
        vm.createSelectFork("https://sepolia-rollup.arbitrum.io/rpc");
        token = IERC20(USDG);
        adapter = new UsdgAdapter(USDG, false);
        PricingEngine pricing = new PricingEngine(address(this));
        PlatformReserve reserve = new PlatformReserve(address(this), address(adapter));
        line = new LockgateCreditLine(address(this), address(adapter), address(pricing), address(reserve));
        reserve.setCreditLine(address(line));
        reserve.setSlasher(address(line), true);
        investor = makeAddr("investor");
        actor = new CreditActor(line, token, investor);
        line.registerSource(address(actor), 1_000_000 * U, 750);
        deal(USDG, address(this), 200_000 * U);
        token.forceApprove(address(line), type(uint256).max);
        line.depositCapital(200_000 * U);
        deal(USDG, address(actor), 20_000 * U);
        actor.postReserve(20_000 * U);
        actor.refresh(600);
    }

    function test_canonicalBookQuotesAndRepays() public {
        assertEq(block.chainid, 421_614);
        assertEq(adapter.token(), USDG);
        assertTrue(adapter.isCanonicalSepoliaUsdg());
        assertFalse(adapter.isMock());
        assertEq(line.token(), USDG);

        (uint256 fee, uint16 bps, bool available, string memory reason) = line.quote(address(actor), NAV);
        assertTrue(available, reason);
        assertEq(bps, 99);
        assertEq(fee, 99 * U);

        uint256 supply = token.totalSupply();
        uint256 investorBefore = token.balanceOf(investor);
        uint256 lineBefore = token.balanceOf(address(line));
        (uint256 id, uint256 drawnFee) = actor.draw(NAV);
        uint256 principal = NAV - drawnFee;
        assertEq(drawnFee, fee);
        assertEq(token.balanceOf(investor), investorBefore + principal);
        assertEq(token.balanceOf(address(actor)), 0);
        assertEq(token.balanceOf(address(line)), lineBefore - principal);
        assertEq(line.outstanding(), principal);
        assertEq(line.totalExposure(), NAV);
        assertEq(token.totalSupply(), supply);

        deal(USDG, address(actor), NAV);
        uint256 supplyAfterDeal = token.totalSupply();
        uint256 investorAtRepay = token.balanceOf(investor);
        actor.repay(id);
        assertEq(token.balanceOf(investor), investorAtRepay);
        assertEq(token.balanceOf(address(actor)), 0);
        assertEq(line.outstanding(), 0);
        assertEq(line.earnedFees(), fee);
        assertEq(line.remainingOf(id), 0);
        assertEq(line.totalExposure(), 0);
        assertEq(token.balanceOf(address(line)), lineBefore + fee);
        assertEq(token.totalSupply(), supplyAfterDeal);
    }

    function test_gateAndStrangerLeaveCanonicalCash() public {
        uint256 lineCash = token.balanceOf(address(line));
        uint256 investorCash = token.balanceOf(investor);
        actor.setGated(true);
        vm.expectRevert(CreditLineAdmin.Gated.selector);
        actor.draw(NAV);
        vm.prank(stranger);
        vm.expectRevert();
        line.withdrawCapital(1);
        assertEq(line.outstanding(), 0);
        assertEq(line.advanceCount(), 0);
        assertEq(token.balanceOf(address(line)), lineCash);
        assertEq(token.balanceOf(investor), investorCash);
        assertEq(token.balanceOf(stranger), 0);
    }
}
