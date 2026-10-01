// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {FacilityMath} from "./libraries/FacilityMath.sol";
import {FacilityStore} from "./FacilityStore.sol";

/// @title FacilityCash
/// @notice Lender deposits and the borrower's draw, repay, default and waterfall.
abstract contract FacilityCash is FacilityStore {
    function deposit(Tranche tranche, uint256 assets) external nonReentrant returns (uint256 shares) {
        if (assets == 0) revert BadParam();
        _count(msg.sender);
        _touch();
        _pull(assets);
        shares = tranche == Tranche.Senior ? _mint(msg.sender, assets, true) : _mint(msg.sender, assets, false);
        emit Deposited(msg.sender, tranche, assets, shares);
    }

    function redeem(Tranche tranche, uint256 shares) external nonReentrant returns (uint256 assets) {
        if (shares == 0) revert BadParam();
        _touch();
        if (tranche == Tranche.Junior && acct.recovery) {
            uint256 seniorOut = acct.drawn < acct.seniorPrincipal ? acct.drawn : acct.seniorPrincipal;
            if (seniorOut > 0 || acct.seniorInterestDue > 0) revert SeniorFirst();
        }
        assets = tranche == Tranche.Senior ? _burn(msg.sender, shares, true) : _burn(msg.sender, shares, false);
        emit Redeemed(msg.sender, tranche, shares, assets);
    }

    function withdrawInterest(Tranche tranche) external nonReentrant returns (uint256 amount) {
        _touch();
        bool senior = tranche == Tranche.Senior;
        _settle(msg.sender, senior);
        amount = senior ? seniorClaim[msg.sender] : juniorClaim[msg.sender];
        if (amount == 0) revert BadParam();
        if (senior) {
            seniorClaim[msg.sender] = 0;
            acct.seniorInterestCash -= amount;
        } else {
            juniorClaim[msg.sender] = 0;
            acct.juniorInterestCash -= amount;
        }
        acct.cash -= amount;
        _push(msg.sender, amount);
        emit InterestPaid(msg.sender, tranche, amount);
    }

    function draw(uint256 amount) external nonReentrant {
        if (msg.sender != borrower || amount == 0) revert Unauthorized();
        _touch();
        if (amount > availableDraw()) revert Covenant();
        acct.cash -= amount;
        acct.drawn += amount;
        _push(borrower, amount);
        emit Drawn(borrower, amount);
    }

    function repay(uint256 amount) external nonReentrant {
        if (amount == 0) revert BadParam();
        _touch();
        _pull(amount);
        FacilityMath.Split memory split = FacilityMath.onRepay(acct, amount);
        _credit(true, split.seniorInterest);
        _credit(false, split.juniorInterest);
        if (acct.recovery) FacilityMath.subordinate(acct);
        _lockOrphans();
        emit Repaid(msg.sender, amount);
    }

    /// @notice Anyone can put the facility into recovery when a covenant fails. Draws stop.
    function poke() external {
        _touch();
        if (acct.recovery || !_breached()) return;
        FacilityMath.enterRecovery(acct);
        emit RecoveryEntered(acct.drawn);
    }

    /// @notice Crystallise the uncollateralised draw. Junior principal takes the loss first.
    ///         A later repayment restores senior before junior. The amount is not a caller input.
    function recognizeLoss() external returns (uint256 loss) {
        _touch();
        if (!acct.recovery) revert NotRecovery();
        FacilityMath.subordinate(acct);
        uint256 base = borrowingBase();
        if (acct.drawn > base) loss = FacilityMath.applyLoss(acct, acct.drawn - base);
        _lockOrphans();
        emit LossRecognized(loss);
    }

    function _mint(address lender, uint256 assets, bool senior) internal returns (uint256 shares) {
        _settle(lender, senior);
        uint256 supply = senior ? seniorSupply : juniorSupply;
        uint256 principal = senior ? acct.seniorPrincipal : acct.juniorPrincipal;
        if (supply == 0) {
            if (principal != 0) revert Unclaimed();
            shares = assets;
        } else {
            if (principal == 0) revert TrancheWiped();
            shares = Math.mulDiv(assets, supply, principal);
        }
        if (shares == 0) revert BadParam();
        if (senior) {
            seniorShares[lender] += shares;
            seniorSupply += shares;
            acct.seniorPrincipal += assets;
        } else {
            juniorShares[lender] += shares;
            juniorSupply += shares;
            acct.juniorPrincipal += assets;
        }
        acct.cash += assets;
    }

    function _burn(address lender, uint256 shares, bool senior) internal returns (uint256 assets) {
        _settle(lender, senior);
        uint256 balance = senior ? seniorShares[lender] : juniorShares[lender];
        uint256 supply = senior ? seniorSupply : juniorSupply;
        uint256 principal = senior ? acct.seniorPrincipal : acct.juniorPrincipal;
        if (shares > balance || supply == 0 || principal == 0) revert BadParam();
        assets = Math.mulDiv(shares, principal, supply);
        uint256 idle = senior ? FacilityMath.idleSenior(acct) : FacilityMath.idleJunior(acct);
        if (assets == 0 || assets > idle) revert BadParam();
        if (senior) {
            seniorShares[lender] -= shares;
            seniorSupply -= shares;
            acct.seniorPrincipal -= assets;
        } else {
            juniorShares[lender] -= shares;
            juniorSupply -= shares;
            acct.juniorPrincipal -= assets;
        }
        acct.cash -= assets;
        _push(lender, assets);
    }
}
