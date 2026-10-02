// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {AdvanceProposal} from "../../src/interfaces/IAdvanceProposal.sol";
import {CreditFacility} from "../../src/facility/CreditFacility.sol";
import {FacilityStore} from "../../src/facility/FacilityStore.sol";
import {PartnerVault} from "../../src/partner/PartnerVault.sol";
import {ReenterPlatform} from "../partner/mocks/ReenterPlatform.sol";
import {VaultFixture} from "../partner/VaultFixture.sol";
import {FacilityFixture} from "../facility/FacilityFixture.sol";

/// @notice Partner cash that arrives at this contract tries to withdraw again.
contract Stage2WithdrawSink {
    PartnerVault public vault;
    bool public withdrew;
    bytes4 public sel;

    function arm(address next) external {
        vault = PartnerVault(next);
    }

    function onTokens() external {
        try vault.withdraw(1, address(this)) {
            withdrew = true;
        } catch (bytes memory err) {
            sel = _sel(err);
        }
    }

    function _sel(bytes memory err) private pure returns (bytes4 s) {
        if (err.length < 4) return bytes4(0);
        assembly {
            s := mload(add(err, 32))
        }
    }
}

/// @notice Borrower that tries to draw again from inside the token transfer.
contract Stage3DrawAgain {
    CreditFacility public facility;
    bool public drewAgain;
    bytes4 public sel;

    function arm(address next) external {
        facility = CreditFacility(next);
    }

    function pull(uint256 amount) external {
        facility.draw(amount);
    }

    function onTokens() external {
        try facility.draw(1) {
            drewAgain = true;
        } catch (bytes memory err) {
            sel = _sel(err);
        }
    }

    function _sel(bytes memory err) private pure returns (bytes4 s) {
        if (err.length < 4) return bytes4(0);
        assembly {
            s := mload(add(err, 32))
        }
    }
}

/// @notice Stage-2 payout and owner withdrawal each pay once. A callback cannot take a second slice.
contract Stage2Reenter is VaultFixture {
    function setUp() public {
        _deploy();
        _openMandate();
        _deposit(1_000_000 * UNIT);
        _reserve(50_000 * UNIT);
    }

    function test_executeReenterPaysOnce() public {
        ReenterPlatform sink = new ReenterPlatform();
        sink.arm(address(vault));
        usdg.setHook(address(sink));
        vm.prank(partner);
        vault.setPlatform(address(sink), true, 10_000_000 * UNIT, 0, false, 1 days);
        AdvanceProposal memory p = _proposal(100_000 * UNIT, 1);
        p.platform = address(sink);
        p.recipient = address(sink);
        bytes memory sig = _engineSig(vault, p);
        uint256 idleBefore = vault.idle();
        vm.prank(partner);
        vault.execute(p, sig, "");
        assertFalse(sink.withdrew());
        assertFalse(sink.executed());
        assertEq(sink.withdrawSel(), ReentrancyGuard.ReentrancyGuardReentrantCall.selector);
        assertEq(sink.executeSel(), ReentrancyGuard.ReentrancyGuardReentrantCall.selector);
        assertEq(usdg.balanceOf(address(sink)), p.payout);
        assertEq(vault.advanceCount(), 1);
        assertEq(vault.idle(), idleBefore - p.payout);
        assertEq(usdg.balanceOf(lockgate), 0);
        assertEq(vault.outstandingPrincipal(), p.payout);
    }

    function test_ownerWithdrawReenterPaysOnce() public {
        Stage2WithdrawSink sink = new Stage2WithdrawSink();
        sink.arm(address(vault));
        usdg.setHook(address(sink));
        uint256 idleBefore = vault.idle();
        uint256 slice = 1_000 * UNIT;
        vm.prank(partner);
        vault.withdraw(slice, address(sink));
        assertFalse(sink.withdrew());
        assertEq(sink.sel(), ReentrancyGuard.ReentrancyGuardReentrantCall.selector);
        assertEq(usdg.balanceOf(address(sink)), slice);
        assertEq(vault.idle(), idleBefore - slice);
        assertEq(usdg.balanceOf(lockgate), 0);
        assertEq(vault.outstandingPrincipal(), 0);
    }
}

/// @notice Stage-3 draw pays the borrower once. The callback cannot draw a second unit.
contract Stage3Reenter is FacilityFixture {
    function test_drawReenterPaysOnce() public {
        _open(10_000, 2_000, 0, 10_000, 0, address(0), 0, 0);
        Stage3DrawAgain actor = new Stage3DrawAgain();
        facility = new CreditFacility(
            FacilityStore.Init({
                governor: governor,
                borrower: address(actor),
                asset: address(usdg),
                book: address(book),
                oracle: address(0),
                minPriceE8: 0,
                maxOracleAge: 0,
                advanceRateBps: 10_000,
                maxLateBps: 2_000,
                minJuniorBps: 0,
                seniorAprBps: 0,
                juniorAprBps: 0
            })
        );
        actor.arm(address(facility));
        _deposit(senior, FacilityStore.Tranche.Senior, 100e6);
        usdg.setHook(address(actor));
        actor.pull(40e6);
        assertFalse(actor.drewAgain());
        assertEq(actor.sel(), ReentrancyGuard.ReentrancyGuardReentrantCall.selector);
        assertEq(usdg.balanceOf(address(actor)), 40e6);
        assertEq(facility.accounting().drawn, 40e6);
        assertEq(facility.accounting().cash, 60e6);
        assertTrue(facility.solvent());
    }
}
