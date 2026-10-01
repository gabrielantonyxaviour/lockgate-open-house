// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {CoreFixture} from "./Support.sol";
import {MockUSDG} from "../../src/core/MockUSDG.sol";

contract MockUsdgTest is CoreFixture {
    function setUp() public {
        _core();
    }

    function test_metadataAndFaucetCap() public {
        assertEq(usdg.decimals(), 6);
        assertEq(usdg.name(), "test USDG");
        assertEq(usdg.symbol(), "USDG");
        assertEq(usdg.FAUCET_MAX(), 10_000e6);
        assertTrue(usdg.minters(owner));

        vm.prank(investor);
        usdg.faucet(10_000e6);
        assertEq(usdg.balanceOf(investor), 10_000e6);

        vm.prank(investor);
        usdg.faucet(10_000e6);
        assertEq(usdg.balanceOf(investor), 20_000e6);

        vm.prank(investor);
        vm.expectRevert(abi.encodeWithSelector(MockUSDG.FaucetCap.selector, 10_001e6));
        usdg.faucet(10_001e6);
    }

    function test_mintAuth() public {
        vm.prank(stranger);
        vm.expectRevert(MockUSDG.NotMinter.selector);
        usdg.mint(stranger, 1);

        vm.prank(owner);
        usdg.setMinter(stranger, true);
        vm.prank(stranger);
        usdg.mint(investor, 5e6);
        assertEq(usdg.balanceOf(investor), 5e6);

        vm.prank(owner);
        vm.expectRevert(MockUSDG.ZeroAddress.selector);
        usdg.mint(address(0), 1);
    }
}
