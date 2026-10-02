// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {CreditFacility} from "../../src/facility/CreditFacility.sol";
import {FacilityStore} from "../../src/facility/FacilityStore.sol";
import {WeirdUSDG} from "../partner/mocks/WeirdUSDG.sol";
import {FacilityFixture} from "./FacilityFixture.sol";

/// @notice Fee-on-transfer, a false return, a rebase, and a hook cannot move unaccounted facility cash.
contract FacilityTokenTest is FacilityFixture {
    function setUp() public {
        _open(10_000, 2_000, 0, 1_000, 0, address(0), 0, 0);
    }

    function test_feeOnTransferRejectsPushes() public {
        (CreditFacility f, WeirdUSDG token) = _weird();
        _put(f, token, 1_000e6);
        token.mint(address(f), 50e6);
        assertEq(f.bookSurplus(), 50e6);
        uint256 shares = f.seniorShares(senior);
        uint256 cash = f.accounting().cash;

        token.setKind(1);
        vm.prank(borrower);
        vm.expectRevert(FacilityStore.BadParam.selector);
        f.draw(100e6);
        vm.prank(senior);
        vm.expectRevert(FacilityStore.BadParam.selector);
        f.redeem(FacilityStore.Tranche.Senior, shares);
        vm.prank(governor);
        vm.expectRevert(FacilityStore.BadParam.selector);
        f.sweepResidual(governor, 50e6);
        token.mint(senior, 10e6);
        vm.startPrank(senior);
        token.approve(address(f), type(uint256).max);
        vm.expectRevert(FacilityStore.BadParam.selector);
        f.deposit(FacilityStore.Tranche.Senior, 10e6);
        vm.stopPrank();

        assertEq(f.accounting().cash, cash);
        assertEq(f.accounting().drawn, 0);
        assertEq(f.accounting().residual, 50e6);
        assertEq(f.seniorShares(senior), shares);
        assertEq(token.balanceOf(borrower), 0);
        assertEq(token.balanceOf(governor), 0);
        assertEq(token.balanceOf(address(f)), cash);

        token.setKind(0);
        vm.prank(governor);
        f.sweepResidual(governor, 50e6);
        vm.prank(borrower);
        f.draw(100e6);
        assertEq(token.balanceOf(borrower), 100e6);
        assertEq(token.balanceOf(governor), 50e6);
        assertEq(f.accounting().drawn, 100e6);
        assertEq(token.balanceOf(address(f)), f.accounting().cash);
        assertTrue(f.solvent());
    }

    function test_returnFalseAndInterestPush() public {
        (CreditFacility f, WeirdUSDG token) = _weird();
        token.setKind(2);
        bytes memory err = abi.encodeWithSelector(SafeERC20.SafeERC20FailedOperation.selector, address(token));
        token.mint(senior, 1_000e6);
        vm.prank(governor);
        f.approveLender(senior, true);
        vm.startPrank(senior);
        token.approve(address(f), type(uint256).max);
        vm.expectRevert(err);
        f.deposit(FacilityStore.Tranche.Senior, 1_000e6);
        vm.stopPrank();
        assertEq(f.accounting().cash, 0);

        token.setKind(0);
        _put(f, token, 1_000e6);
        token.setKind(2);
        vm.prank(borrower);
        vm.expectRevert(err);
        f.draw(100e6);
        assertEq(f.accounting().drawn, 0);
        assertEq(token.balanceOf(address(f)), 1_000e6);

        token.setKind(0);
        vm.prank(borrower);
        f.draw(100e6);
        uint64 start = f.accounting().lastAccrual;
        vm.warp(start + 365 days);
        token.mint(borrower, 10e6);
        vm.startPrank(borrower);
        token.approve(address(f), type(uint256).max);
        f.repay(10e6);
        vm.stopPrank();
        assertEq(f.accounting().seniorInterestDue, 0);
        assertEq(f.accounting().seniorInterestCash, 10e6);

        token.setKind(1);
        uint256 seniorBal = token.balanceOf(senior);
        vm.prank(senior);
        vm.expectRevert(FacilityStore.BadParam.selector);
        f.withdrawInterest(FacilityStore.Tranche.Senior);
        assertEq(f.accounting().seniorInterestCash, 10e6);
        assertEq(token.balanceOf(senior), seniorBal);

        token.setKind(0);
        vm.prank(senior);
        assertEq(f.withdrawInterest(FacilityStore.Tranche.Senior), 10e6);
        assertEq(f.seniorClaim(senior), 0);
        assertEq(token.balanceOf(address(f)), f.accounting().cash);
    }

    function test_rebaseDownBricksUntilRestoredAndSurplusIsResidual() public {
        (CreditFacility f, WeirdUSDG token) = _weird();
        _put(f, token, 1_000e6);
        token.rebase(address(f), 1e6, true);
        vm.prank(borrower);
        vm.expectRevert(FacilityStore.BadParam.selector);
        f.draw(1e6);
        vm.expectRevert(FacilityStore.BadParam.selector);
        f.bookSurplus();
        assertEq(f.accounting().cash, 1_000e6);

        token.rebase(address(f), 1e6, false);
        vm.prank(borrower);
        f.draw(1e6);
        assertEq(f.accounting().drawn, 1e6);

        token.rebase(address(f), 7e6, false);
        vm.prank(borrower);
        vm.expectRevert(FacilityStore.BadParam.selector);
        f.draw(1e6);
        vm.expectEmit(false, false, false, true);
        emit FacilityStore.SurplusBooked(7e6);
        assertEq(f.bookSurplus(), 7e6);
        assertEq(f.accounting().residual, 7e6);
        vm.prank(governor);
        f.sweepResidual(governor, 7e6);
        assertEq(f.accounting().residual, 0);
        assertEq(token.balanceOf(governor), 7e6);
        assertEq(token.balanceOf(address(f)), f.accounting().cash);
        assertTrue(f.solvent());
    }

    function test_reentrantHookCannotDoubleSpend() public {
        (CreditFacility f, WeirdUSDG token) = _weird();
        FacilityAttacker attacker = new FacilityAttacker(f);
        bytes4 guard = ReentrancyGuard.ReentrancyGuardReentrantCall.selector;
        token.mint(senior, 1_000e6);
        vm.prank(governor);
        f.approveLender(senior, true);
        vm.prank(senior);
        token.approve(address(f), type(uint256).max);
        token.arm(address(attacker));
        vm.prank(senior);
        f.deposit(FacilityStore.Tranche.Senior, 1_000e6);
        assertEq(f.accounting().cash, 1_000e6);
        assertEq(token.balanceOf(address(attacker)), 0);
        assertFalse(attacker.drew() || attacker.redeemed());
        assertEq(bytes32(attacker.drawSel()), bytes32(guard));
        assertEq(bytes32(attacker.redeemSel()), bytes32(guard));

        token.arm(address(attacker));
        vm.prank(borrower);
        f.draw(40e6);
        assertEq(f.accounting().drawn, 40e6);
        assertEq(token.balanceOf(borrower), 40e6);
        assertFalse(attacker.drew());
        assertEq(bytes32(attacker.drawSel()), bytes32(guard));
        assertEq(token.balanceOf(address(f)), f.accounting().cash);
    }

    function _weird() internal returns (CreditFacility f, WeirdUSDG token) {
        token = new WeirdUSDG();
        f = new CreditFacility(
            FacilityStore.Init({
                governor: governor,
                borrower: borrower,
                asset: address(token),
                book: address(book),
                oracle: address(0),
                minPriceE8: 0,
                maxOracleAge: 0,
                advanceRateBps: 10_000,
                maxLateBps: 2_000,
                minJuniorBps: 0,
                seniorAprBps: 1_000,
                juniorAprBps: 0
            })
        );
    }

    function _put(CreditFacility f, WeirdUSDG token, uint256 amount) internal {
        token.mint(senior, amount);
        vm.prank(governor);
        f.approveLender(senior, true);
        vm.startPrank(senior);
        token.approve(address(f), type(uint256).max);
        f.deposit(FacilityStore.Tranche.Senior, amount);
        vm.stopPrank();
    }
}

contract FacilityAttacker {
    CreditFacility public facility;
    bytes4 public drawSel;
    bytes4 public redeemSel;
    bool public drew;
    bool public redeemed;

    constructor(CreditFacility facility_) {
        facility = facility_;
    }

    function onTokens() external {
        try facility.draw(1) {
            drew = true;
        } catch (bytes memory err) {
            drawSel = _sel(err);
        }
        try facility.redeem(FacilityStore.Tranche.Senior, 1) returns (uint256) {
            redeemed = true;
        } catch (bytes memory err) {
            redeemSel = _sel(err);
        }
    }

    function _sel(bytes memory err) private pure returns (bytes4 sel) {
        if (err.length < 4) return bytes4(0);
        assembly {
            sel := mload(add(err, 32))
        }
    }
}
