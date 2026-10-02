// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {FacilityCash} from "./FacilityCash.sol";

/// @title CreditFacility
/// @notice Institutions lend to Lockgate's own book, senior then junior.
/// @dev Positions do not transfer. At most 50 lenders. Looser terms, a new receivables book,
///      and a new peg oracle wait two days. Tighter terms apply immediately. Partner vaults
///      are not an input unless a governor explicitly schedules one, and tests should not.
contract CreditFacility is FacilityCash {
    event BookScheduled(address indexed book, uint64 eta);
    event BookSet(address indexed book);
    event OracleScheduled(address indexed oracle, uint64 eta);
    event OracleSet(address indexed oracle, uint64 minPriceE8, uint64 maxOracleAge);

    constructor(Init memory init) {
        _init(init);
    }

    /// @notice Governor admits or drops a lender. A drop does not free a cap slot.
    function approveLender(address lender, bool approved) external {
        _onlyGovernor();
        if (lender == address(0)) revert BadParam();
        approvedLender[lender] = approved;
        emit LenderApproved(lender, approved);
    }

    /// @notice Starts a handover. The current governor stays until `acceptGovernor`.
    function transferGovernor(address next) external {
        _onlyGovernor();
        if (next == address(0)) revert BadParam();
        pendingGovernor = next;
        emit GovernorTransferStarted(next);
    }

    /// @notice Pending governor becomes the only address that can change terms.
    function acceptGovernor() external {
        if (msg.sender != pendingGovernor) revert Unauthorized();
        governor = msg.sender;
        pendingGovernor = address(0);
        emit GovernorSet(msg.sender);
    }

    /// @notice Lower the advance rate now. A higher rate waits on `scheduleTerms`.
    function tightenAdvanceRate(uint16 bps) external {
        _onlyGovernor();
        if (bps >= acct.advanceRateBps) revert BadParam();
        acct.advanceRateBps = bps;
        emit TermsTightened(bps, acct.maxLateBps, acct.minJuniorBps);
    }

    /// @notice Lower the late-receivables cap now.
    function tightenMaxLate(uint16 bps) external {
        _onlyGovernor();
        if (bps >= acct.maxLateBps) revert BadParam();
        acct.maxLateBps = bps;
        emit TermsTightened(acct.advanceRateBps, bps, acct.minJuniorBps);
    }

    /// @notice Raise the junior-capital floor now.
    function tightenMinJunior(uint16 bps) external {
        _onlyGovernor();
        if (bps <= acct.minJuniorBps || bps > BPS) revert BadParam();
        acct.minJuniorBps = bps;
        emit TermsTightened(acct.advanceRateBps, acct.maxLateBps, bps);
    }

    /// @notice Queue a full term set. It can be executed after two days.
    function scheduleTerms(PendingTerms calldata next) external {
        _onlyGovernor();
        if (next.advanceRateBps > BPS || next.maxLateBps > BPS || next.minJuniorBps > BPS) revert BadParam();
        if (next.seniorAprBps > BPS || next.juniorAprBps > BPS) revert BadParam();
        pendingTerms = next;
        pendingTerms.eta = uint64(block.timestamp + CHANGE_DELAY);
        pendingTerms.active = true;
        emit TermsScheduled(
            pendingTerms.advanceRateBps,
            pendingTerms.maxLateBps,
            pendingTerms.minJuniorBps,
            pendingTerms.seniorAprBps,
            pendingTerms.juniorAprBps,
            pendingTerms.eta
        );
    }

    /// @notice Apply the queued terms. Interest accrued so far uses the old rates.
    function executeTerms() external {
        _onlyGovernor();
        if (!pendingTerms.active || block.timestamp < pendingTerms.eta) revert TooEarly();
        _touch();
        acct.advanceRateBps = pendingTerms.advanceRateBps;
        acct.maxLateBps = pendingTerms.maxLateBps;
        acct.minJuniorBps = pendingTerms.minJuniorBps;
        acct.seniorAprBps = pendingTerms.seniorAprBps;
        acct.juniorAprBps = pendingTerms.juniorAprBps;
        pendingTerms.active = false;
        emit TermsExecuted(
            acct.advanceRateBps, acct.maxLateBps, acct.minJuniorBps, acct.seniorAprBps, acct.juniorAprBps
        );
    }

    /// @notice Drop a queued term set. A later execute reverts `TooEarly`.
    function cancelTerms() external {
        _onlyGovernor();
        if (!pendingTerms.active) revert BadParam();
        pendingTerms.active = false;
        emit TermsCancelled();
    }

    /// @notice Queue a receivables book. Address zero is allowed and makes the base unreadable.
    function scheduleBook(address book) external {
        _onlyGovernor();
        pendingBook = book;
        bookEta = uint64(block.timestamp + CHANGE_DELAY);
        emit BookScheduled(book, bookEta);
    }

    /// @notice Point the borrowing base at the queued book.
    function executeBook() external {
        _onlyGovernor();
        if (bookEta == 0 || block.timestamp < bookEta) revert TooEarly();
        receivables = pendingBook;
        bookEta = 0;
        emit BookSet(receivables);
    }

    /// @notice Queue a peg oracle, its floor, and its maximum age.
    function scheduleOracle(address next, uint64 minPrice, uint64 maxAge) external {
        _onlyGovernor();
        pendingOracle = next;
        pendingMinPrice = minPrice;
        pendingMaxAge = maxAge;
        oracleEta = uint64(block.timestamp + CHANGE_DELAY);
        emit OracleScheduled(next, oracleEta);
    }

    /// @notice Apply the queued peg oracle.
    function executeOracle() external {
        _onlyGovernor();
        if (oracleEta == 0 || block.timestamp < oracleEta) revert TooEarly();
        oracle = pendingOracle;
        minPriceE8 = pendingMinPrice;
        maxOracleAge = pendingMaxAge;
        oracleEta = 0;
        emit OracleSet(oracle, minPriceE8, maxOracleAge);
    }

    /// @notice Surplus after lenders are paid. Blocked while a default is still short senior.
    function sweepResidual(address to, uint256 amount) external nonReentrant {
        _onlyGovernor();
        if (to == address(0) || amount == 0 || amount > acct.residual) revert BadParam();
        if (acct.recovery && (acct.drawn != 0 || acct.seniorDeficit != 0 || acct.seniorInterestDue != 0)) {
            revert SeniorFirst();
        }
        acct.residual -= amount;
        acct.cash -= amount;
        _push(to, amount);
        emit ResidualSwept(to, amount);
    }
}
