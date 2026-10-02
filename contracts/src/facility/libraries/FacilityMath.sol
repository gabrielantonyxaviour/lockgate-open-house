// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

/// @title FacilityMath
/// @notice Accrual, subordination and the repayment waterfall for Lockgate's own credit facility.
library FacilityMath {
    uint256 internal constant BPS = 10_000;
    uint256 internal constant YEAR = 365 days;

    struct State {
        uint256 cash;
        uint256 drawn;
        uint256 seniorDrawn;
        uint256 seniorPrincipal;
        uint256 juniorPrincipal;
        uint256 seniorDeficit;
        uint256 juniorDeficit;
        uint256 seniorInterestDue;
        uint256 juniorInterestDue;
        uint256 seniorInterestCash;
        uint256 juniorInterestCash;
        uint256 residual;
        uint256 locked;
        uint64 seniorAprBps;
        uint64 juniorAprBps;
        uint16 advanceRateBps;
        uint16 maxLateBps;
        uint16 minJuniorBps;
        uint64 lastAccrual;
        bool recovery;
    }

    struct Split {
        uint256 seniorInterest;
        uint256 seniorPrincipalPay;
        uint256 seniorRestore;
        uint256 juniorInterest;
        uint256 juniorPrincipalPay;
        uint256 juniorRestore;
        uint256 residualAdd;
    }

    function solvent(State memory s) internal pure returns (bool) {
        return s.cash + s.drawn
            == s.seniorPrincipal + s.juniorPrincipal + s.seniorInterestCash + s.juniorInterestCash + s.residual
                + s.locked;
    }

    function accrue(State storage s, uint256 nowTs) internal {
        if (nowTs <= s.lastAccrual) return;
        uint256 dt = nowTs - s.lastAccrual;
        if (!s.recovery && s.drawn > 0 && dt > 0) {
            uint256 seniorOut = s.seniorDrawn;
            uint256 juniorOut = s.drawn - seniorOut;
            if (seniorOut > 0 && s.seniorAprBps > 0) {
                s.seniorInterestDue += _interest(seniorOut, s.seniorAprBps, dt);
            }
            if (juniorOut > 0 && s.juniorAprBps > 0) {
                s.juniorInterestDue += _interest(juniorOut, s.juniorAprBps, dt);
            }
        }
        s.lastAccrual = uint64(nowTs);
    }

    function idleSenior(State memory s) internal pure returns (uint256) {
        return s.seniorPrincipal - s.seniorDrawn;
    }

    function idleJunior(State memory s) internal pure returns (uint256) {
        return s.juniorPrincipal - (s.drawn - s.seniorDrawn);
    }

    /// @notice New borrowing uses idle senior cash first, then idle junior cash.
    function fundDraw(State storage s, uint256 amount) internal {
        uint256 room = s.seniorPrincipal - s.seniorDrawn;
        uint256 toSenior = amount < room ? amount : room;
        s.seniorDrawn += toSenior;
        s.drawn += amount;
    }

    function drawable(State memory s) internal pure returns (uint256) {
        return idleSenior(s) + idleJunior(s);
    }

    /// @dev Junior idle pays `seniorDrawn`. The senior slice falls, so a second call shifts nothing.
    function subordinate(State storage s) internal {
        if (!s.recovery || s.seniorDrawn == 0) return;
        uint256 juniorIdle = idleJunior(s);
        uint256 shift = juniorIdle < s.seniorDrawn ? juniorIdle : s.seniorDrawn;
        if (shift == 0) return;
        s.juniorPrincipal -= shift;
        s.juniorDeficit += shift;
        s.seniorDrawn -= shift;
        s.drawn -= shift;
    }

    function enterRecovery(State storage s) internal {
        if (s.recovery) return;
        s.recovery = true;
        s.juniorInterestDue = 0;
        subordinate(s);
    }

    function applyLoss(State storage s, uint256 loss) internal returns (uint256 applied) {
        if (loss > s.drawn) loss = s.drawn;
        uint256 juniorTake = loss < s.juniorPrincipal ? loss : s.juniorPrincipal;
        s.juniorPrincipal -= juniorTake;
        s.juniorDeficit += juniorTake;
        uint256 seniorTake = loss - juniorTake;
        if (seniorTake > s.seniorPrincipal) seniorTake = s.seniorPrincipal;
        s.seniorPrincipal -= seniorTake;
        s.seniorDeficit += seniorTake;
        applied = juniorTake + seniorTake;
        uint256 juniorSlice = s.drawn - s.seniorDrawn;
        uint256 fromSenior = applied > juniorSlice ? applied - juniorSlice : 0;
        s.seniorDrawn -= fromSenior;
        s.drawn -= applied;
    }

    /// @notice Senior interest, senior principal, senior loss restore, then junior, then residual.
    function onRepay(State storage s, uint256 amount) internal returns (Split memory split) {
        s.cash += amount;
        uint256 left = amount;
        (split.seniorInterest, left) = _take(s.seniorInterestDue, left);
        s.seniorInterestDue -= split.seniorInterest;
        s.seniorInterestCash += split.seniorInterest;
        (split.seniorPrincipalPay, left) = _take(s.seniorDrawn, left);
        s.seniorDrawn -= split.seniorPrincipalPay;
        s.drawn -= split.seniorPrincipalPay;
        (split.seniorRestore, left) = _take(s.seniorDeficit, left);
        s.seniorDeficit -= split.seniorRestore;
        s.seniorPrincipal += split.seniorRestore;
        (split.juniorInterest, left) = _take(s.juniorInterestDue, left);
        s.juniorInterestDue -= split.juniorInterest;
        s.juniorInterestCash += split.juniorInterest;
        (split.juniorPrincipalPay, left) = _take(s.drawn - s.seniorDrawn, left);
        s.drawn -= split.juniorPrincipalPay;
        (split.juniorRestore, left) = _take(s.juniorDeficit, left);
        s.juniorDeficit -= split.juniorRestore;
        s.juniorPrincipal += split.juniorRestore;
        s.residual += left;
        split.residualAdd = left;
    }

    function _interest(uint256 principal, uint256 aprBps, uint256 dt) private pure returns (uint256) {
        uint256 perYear = Math.mulDiv(principal, aprBps, BPS);
        return Math.mulDiv(perYear, dt, YEAR);
    }

    function _take(uint256 owed, uint256 left) private pure returns (uint256 paid, uint256 rest) {
        paid = left < owed ? left : owed;
        rest = left - paid;
    }
}
