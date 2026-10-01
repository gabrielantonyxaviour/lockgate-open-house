// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {CoreFixture} from "./Support.sol";
import {UsdgAdapter} from "../../src/core/UsdgAdapter.sol";

contract Eighteen is ERC20 {
    constructor() ERC20("eighteen", "E18") {}

    function decimals() public pure override returns (uint8) {
        return 18;
    }
}

contract UsdgAdapterTest is CoreFixture {
    function setUp() public {
        _core();
    }

    function test_rejectsWrongDecimalsAndZero() public {
        Eighteen bad = new Eighteen();
        vm.expectRevert(abi.encodeWithSelector(UsdgAdapter.BadDecimals.selector, uint8(18)));
        new UsdgAdapter(address(bad), true);
        vm.expectRevert(UsdgAdapter.ZeroAddress.selector);
        new UsdgAdapter(address(0), true);
    }

    function test_canonicalSepoliaCannotBeMock() public {
        address canonical = 0xFFC95faa3d63Cde504a05B567C600B78C0b41892;
        vm.etch(canonical, address(usdg).code);
        UsdgAdapter realToken = new UsdgAdapter(canonical, false);
        assertEq(realToken.ARBITRUM_SEPOLIA_USDG(), canonical);
        assertTrue(realToken.isCanonicalSepoliaUsdg());
        assertFalse(realToken.isMock());
        assertEq(realToken.decimals(), 6);
        assertEq(realToken.token(), canonical);
        vm.expectRevert(UsdgAdapter.CanonicalCannotBeMock.selector);
        new UsdgAdapter(canonical, true);
    }

    function test_mockFlagIsExplicit() public {
        UsdgAdapter wrapped = new UsdgAdapter(address(usdg), false);
        assertFalse(wrapped.isMock());
        assertFalse(wrapped.isCanonicalSepoliaUsdg());
        assertEq(adapter.balanceOf(address(line)), 500_000e6);
    }
}
