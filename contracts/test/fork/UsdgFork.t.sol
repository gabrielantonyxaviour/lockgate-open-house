// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {UsdgAdapter} from "../../src/core/UsdgAdapter.sol";

/// @notice Read-only fork of Arbitrum Sepolia USDG. No broadcast and no mainnet.
///         RPC: https://sepolia-rollup.arbitrum.io/rpc
///         Token: https://sepolia.arbiscan.io/token/0xFFC95faa3d63Cde504a05B567C600B78C0b41892
contract UsdgFork is Test {
    address internal constant USDG = 0xFFC95faa3d63Cde504a05B567C600B78C0b41892;
    /// @dev Pin 314719112 was read on 2026-10-01 (supply 2111011000100). The public
    ///      endpoint refuses that historical state, and the cheatcode error is not a
    ///      Solidity revert, so this suite forks the endpoint's latest block.

    function setUp() public {
        vm.createSelectFork("https://sepolia-rollup.arbitrum.io/rpc");
    }

    function test_usdgIsSixDecimals() public view {
        assertEq(block.chainid, 421_614);
        assertEq(IERC20Metadata(USDG).decimals(), 6);
        assertEq(IERC20Metadata(USDG).symbol(), "USDG");
        assertGt(IERC20(USDG).totalSupply(), 0);
        // `block.number` on this Foundry fork is the parent-chain block, not the L2
        // pin 314719112 observed on 2026-10-01. The public RPC does not serve that pin.
        assertGt(block.number, 0);
    }

    function test_transferConservesSupply() public {
        uint256 supply = IERC20(USDG).totalSupply();
        address alice = makeAddr("alice");
        address bob = makeAddr("bob");
        deal(USDG, alice, 1_000e6);
        uint256 afterDeal = IERC20(USDG).totalSupply();
        vm.prank(alice);
        IERC20(USDG).transfer(bob, 250e6);
        assertEq(IERC20(USDG).balanceOf(alice), 750e6);
        assertEq(IERC20(USDG).balanceOf(bob), 250e6);
        assertEq(IERC20(USDG).totalSupply(), afterDeal);
        assertGe(afterDeal, supply);
    }

    function test_adapterBindsTheCanonicalTokenAsNotMock() public {
        UsdgAdapter adapter = new UsdgAdapter(USDG, false);
        assertEq(adapter.token(), USDG);
        assertEq(adapter.decimals(), 6);
        assertTrue(adapter.isCanonicalSepoliaUsdg());
        assertFalse(adapter.isMock());
    }

    function test_transferAboveBalanceReverts() public {
        address alice = makeAddr("alice");
        address bob = makeAddr("bob");
        deal(USDG, alice, 100e6);
        vm.prank(alice);
        vm.expectRevert();
        IERC20(USDG).transfer(bob, 101e6);
        assertEq(IERC20(USDG).balanceOf(alice), 100e6);
        assertEq(IERC20(USDG).balanceOf(bob), 0);
    }

    function test_canonicalTokenCannotBeMarkedMock() public {
        vm.expectRevert(UsdgAdapter.CanonicalCannotBeMock.selector);
        new UsdgAdapter(USDG, true);
    }
}
