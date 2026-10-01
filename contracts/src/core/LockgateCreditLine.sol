// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ICreditSource} from "../interfaces/ICreditSource.sol";
import {ILockgateCreditLine} from "../interfaces/ILockgateCreditLine.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {CreditLineAdmin} from "./CreditLineAdmin.sol";
import {PricingMath} from "./PricingMath.sol";
import {UsdgTransfers} from "./UsdgTransfers.sol";

/// @title LockgateCreditLine
/// @notice Stage-1 book. A registered platform draws `navValue` and `to` receives `navValue - fee`.
///         The platform owes `navValue` back. Fees are realized only as that obligation is recovered.
contract LockgateCreditLine is CreditLineAdmin {
    constructor(address owner_, address adapter, address pricing_, address reserve_)
        CreditLineAdmin(owner_, adapter, pricing_, reserve_)
    {}

    /// @inheritdoc ILockgateCreditLine
    function draw(uint256 navValue, address to, uint256 maxFee)
        external
        whenNotPaused
        nonReentrant
        returns (uint256 advanceId, uint256 fee)
    {
        if (to == address(0)) revert ZeroAddress();
        (uint8 code, uint256 priced,, uint64 dueAt) = _evaluate(msg.sender, navValue);
        if (code != 0) _revert(code);
        if (priced > maxFee) revert FeeTooHigh(priced, maxFee);
        fee = priced;
        uint256 principal = navValue - fee;
        advanceId = ++advanceCount;
        _graceOf[advanceId] = grace;
        _advances[advanceId] = Advance({
            source: msg.sender,
            to: to,
            principal: principal,
            fee: fee,
            drawnAt: uint64(block.timestamp),
            dueAt: dueAt,
            status: AdvanceStatus.Active
        });
        _advanceIds[msg.sender].push(advanceId);
        outstanding += principal;
        _exposure[msg.sender] += navValue;
        totalExposure += navValue;
        eligibleOutstanding += navValue;
        UsdgTransfers.push(token, to, principal);
        emit AdvanceDrawn(advanceId, msg.sender, to, principal, fee, dueAt);
    }

    /// @inheritdoc ILockgateCreditLine
    function repay(uint256 advanceId) external nonReentrant {
        Advance storage advance = _advances[advanceId];
        if (advance.source == address(0)) revert UnknownAdvance();
        if (advance.status != AdvanceStatus.Active && advance.status != AdvanceStatus.Late) revert BadStatus();
        uint256 remaining = _remaining(advanceId);
        if (remaining == 0) revert AlreadySettled();
        _applyRecovery(advanceId, remaining);
        if (advance.status == AdvanceStatus.Active) advance.status = AdvanceStatus.Repaid;
        UsdgTransfers.pull(token, advance.source, address(this), remaining);
        emit AdvanceRepaid(advanceId, advance.source, remaining, advance.status);
    }

    /// @inheritdoc ILockgateCreditLine
    function markLate(uint256 advanceId) external nonReentrant {
        Advance storage advance = _advances[advanceId];
        if (advance.source == address(0)) revert UnknownAdvance();
        if (advance.status != AdvanceStatus.Active) revert BadStatus();
        if (block.timestamp < uint256(advance.dueAt) + _graceOf[advanceId]) revert TooEarly();
        uint256 remaining = _remaining(advanceId);
        uint256 slashed = reserveVault.slash(advance.source, remaining);
        if (slashed > 0) _applyRecovery(advanceId, slashed);
        uint256 left = _remaining(advanceId);
        if (left != 0) {
            eligibleOutstanding -= left;
            lateOutstanding += left;
        }
        advance.status = AdvanceStatus.Late;
        emit AdvanceMarkedLate(advanceId, advance.source, slashed, _remaining(advanceId));
    }

    /// @inheritdoc ILockgateCreditLine
    function quote(address source, uint256 navValue)
        external
        view
        returns (uint256 fee, uint16 feeBps, bool available, string memory reason)
    {
        (uint8 code, uint256 priced, uint16 bps,) = _evaluate(source, navValue);
        if (code != 0) return (0, 0, false, _reason(code));
        return (priced, bps, true, "");
    }

    function _evaluate(address source, uint256 navValue)
        internal
        view
        returns (uint8 code, uint256 fee, uint16 bps, uint64 dueAt)
    {
        code = _precheck(source, navValue);
        if (code != 0) return (code, 0, 0, 0);
        dueAt = ICreditSource(source).nextWindow();
        (code, fee, bps) = _priceAndCaps(source, navValue, dueAt);
    }

    function _precheck(address source, uint256 navValue) internal view returns (uint8) {
        if (!registered[source]) return 1;
        if (paused()) return 2;
        if (navValue == 0) return 3;
        if (ICreditSource(source).gated()) return 4;
        if (ICreditSource(source).nextWindow() <= block.timestamp) return 5;
        if (ICreditSource(source).navUpdatedAt() > block.timestamp) return 6;
        if (_exposure[source] + navValue > limitOf[source]) return 7;
        return 0;
    }

    function _priceAndCaps(address source, uint256 navValue, uint64 dueAt)
        internal
        view
        returns (uint8 code, uint256 fee, uint16 bps)
    {
        uint256 conc = Math.mulDiv(_exposure[source] + navValue, BPS, totalExposure + navValue, Math.Rounding.Ceil);
        if (conc > maxConcentrationBps) return (8, 0, 0);
        (bps, code) = _priced(source, dueAt, uint16(conc));
        if (code != 0) return (code, 0, 0);
        fee = PricingMath.feeFromBps(navValue, bps);
        if (fee >= navValue) return (12, 0, 0);
        uint256 principal = navValue - fee;
        if (capital() < principal) return (11, 0, 0);
        uint256 denom = capital() + outstanding;
        if (Math.mulDiv(outstanding + principal, BPS, denom, Math.Rounding.Ceil) > maxUtilizationBps) return (9, 0, 0);
        uint256 required_ = Math.mulDiv(_exposure[source] + navValue, _activeReserveBps(source), BPS, Math.Rounding.Ceil);
        if (reserveVault.balanceOf(source) < required_) return (10, 0, 0);
        return (0, fee, bps);
    }

    function _priced(address source, uint64 dueAt, uint16 conc) internal view returns (uint16 bps, uint8 code) {
        (bps, code) = pricing.feeCode(
            uint256(dueAt - block.timestamp),
            block.timestamp - ICreditSource(source).navUpdatedAt(),
            false,
            conc,
            utilizationBps(),
            riskOf[source]
        );
        if (code != 0) bps = 0;
    }

    function _applyRecovery(uint256 id, uint256 amount) internal {
        Advance storage advance = _advances[id];
        uint256 recovered = recoveredOf[id];
        uint256 oldUnpaid = recovered >= advance.principal ? 0 : advance.principal - recovered;
        uint256 newRec = recovered + amount;
        uint256 newUnpaid = newRec >= advance.principal ? 0 : advance.principal - newRec;
        outstanding -= oldUnpaid - newUnpaid;
        uint256 oldFee = recovered > advance.principal ? recovered - advance.principal : 0;
        uint256 newFee = newRec > advance.principal ? newRec - advance.principal : 0;
        earnedFees += newFee - oldFee;
        _exposure[advance.source] -= amount;
        if (_exposure[advance.source] == 0) _setReserveFloor(advance.source, reserveBpsOf[advance.source]);
        totalExposure -= amount;
        if (advance.status == AdvanceStatus.Active) eligibleOutstanding -= amount;
        else lateOutstanding -= amount;
        recoveredOf[id] = newRec;
    }

    function _reason(uint8 code) internal pure returns (string memory) {
        if (code == 1) return "unregistered";
        if (code == 2) return "paused";
        if (code == 3) return "zero";
        if (code == 4) return "gated";
        if (code == 5) return "window due";
        if (code == 6) return "bad nav time";
        if (code == 7) return "over limit";
        if (code == 8) return "concentration";
        if (code == 9) return "utilization";
        if (code == 10) return "reserve";
        if (code == 11) return "capital";
        if (code == 12) return "fee consumes value";
        if (code == 13) return "stale nav";
        if (code == 14) return "tenor";
        if (code == 15) return "fee above max";
        return "pricing";
    }

    function _revert(uint8 code) internal pure {
        if (code == 1) revert Unregistered();
        if (code == 3) revert ZeroAmount();
        if (code == 4) revert Gated();
        if (code == 5) revert WindowDue();
        if (code == 6) revert BadNavTime();
        if (code == 7) revert OverLimit();
        if (code == 8) revert ConcentrationCap();
        if (code == 9) revert UtilizationCap();
        if (code == 10) revert ReserveShort();
        if (code == 11) revert CapitalShort();
        if (code == 12) revert FeeConsumesValue();
        if (code == 13) revert StaleNav();
        if (code == 14) revert Tenor();
        if (code == 15) revert FeeAboveMax();
        revert BadParam();
    }
}
