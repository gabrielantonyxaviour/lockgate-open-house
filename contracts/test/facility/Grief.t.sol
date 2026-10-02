// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {FacilityStore} from "../../src/facility/FacilityStore.sol";
import {FacilityFixture} from "./FacilityFixture.sol";

/// @notice Many tiny repayments leave another lender's redemption, and the next repayment, flat.
contract FacilityGriefTest is FacilityFixture {
    uint256 internal constant COUNT = 32;
    uint256 internal constant TINY = 1e6;
    uint256 internal constant SLACK = 25_000;
    uint256 internal constant CAP = 300_000;

    function test_tinyRepaysDoNotBlockAnotherLender() public {
        (uint256 quietRedeem, uint256 quietRepay) = _run(0);
        (uint256 noisyRedeem, uint256 noisyRepay) = _run(COUNT);
        assertLt(noisyRedeem, quietRedeem + SLACK);
        assertLt(noisyRepay, quietRepay + SLACK);
        assertLt(noisyRedeem, CAP);
        assertLt(noisyRepay, CAP);

        address noisyLender = makeAddr("noisy-lender");
        assertEq(usdg.balanceOf(noisyLender), TINY);
        assertEq(facility.seniorShares(noisyLender), 199_999e6);
        assertEq(facility.seniorShares(senior), 200_000e6);
        assertEq(facility.juniorShares(junior), 100_000e6);
        assertEq(facility.accounting().drawn, 199_967e6);
        assertEq(usdg.balanceOf(senior), 0);
        assertTrue(facility.solvent());
    }

    function _run(uint256 n) internal returns (uint256 redeemGas, uint256 repayGas) {
        _open(8_000, 2_000, 2_000, 0, 0, address(0), 0, 0);
        _deposit(senior, FacilityStore.Tranche.Senior, 200_000e6);
        address lender = makeAddr(n == 0 ? "quiet-lender" : "noisy-lender");
        _deposit(lender, FacilityStore.Tranche.Senior, 200_000e6);
        _deposit(junior, FacilityStore.Tranche.Junior, 100_000e6);
        vm.prank(borrower);
        facility.draw(200_000e6);
        for (uint256 i; i < n; ++i) {
            _repay(TINY);
        }
        uint256 start = gasleft();
        vm.prank(lender);
        facility.redeem(FacilityStore.Tranche.Senior, TINY);
        redeemGas = start - gasleft();
        usdg.mint(borrower, TINY);
        vm.prank(borrower);
        usdg.approve(address(facility), TINY);
        start = gasleft();
        vm.prank(borrower);
        facility.repay(TINY);
        repayGas = start - gasleft();
    }

    function _repay(uint256 amount) internal {
        usdg.mint(borrower, amount);
        vm.startPrank(borrower);
        usdg.approve(address(facility), amount);
        facility.repay(amount);
        vm.stopPrank();
    }
}
