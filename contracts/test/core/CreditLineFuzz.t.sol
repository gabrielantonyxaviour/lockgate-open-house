// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {CoreFixture, StubSource} from "./Support.sol";

contract CreditLineFuzzTest is CoreFixture {
    function setUp() public {
        _core();
    }

    function testFuzz_drawAndRepayKeepTheBook(uint96 navValue) public {
        navValue = uint96(bound(navValue, 1e6, 50_000e6));
        StubSource stub = _stub(1_000_000e6, 750);
        uint256 reserveNeed = (uint256(navValue) * 750 + 9_999) / 10_000;
        _post(address(stub), reserveNeed);
        uint256 investorBefore = usdg.balanceOf(investor);
        (uint256 id, uint256 fee) = stub.draw(navValue, investor, type(uint256).max);
        assertEq(usdg.balanceOf(investor) - investorBefore, uint256(navValue) - fee);
        assertEq(line.remainingOf(id), navValue);
        assertEq(line.eligibleOutstanding(), navValue);
        assertEq(line.lateOutstanding(), 0);
        assertEq(fee, (uint256(navValue) * 99 + 9_999) / 10_000);
        _mint(address(stub), navValue);
        line.repay(id);
        assertEq(line.earnedFees(), fee);
        assertEq(line.outstanding(), 0);
        assertEq(line.exposure(address(stub)), 0);
        assertEq(line.eligibleOutstanding() + line.lateOutstanding(), line.totalExposure());
        assertEq(line.accountedAssets(), line.accountedEquity());
    }
}
