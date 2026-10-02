// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IPegOracle} from "../partner/interfaces/IPegOracle.sol";
import {IReceivablesBook} from "./interfaces/IReceivablesBook.sol";
import {FacilityMath} from "./libraries/FacilityMath.sol";

/// @title FacilityStore
/// @notice Shared accounting for Lockgate's own facility. This contract never reads a partner vault.
abstract contract FacilityStore is ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 internal constant RAY = 1e27;
    uint256 public constant MAX_LENDERS = 50;
    uint64 public constant CHANGE_DELAY = 2 days;
    uint256 internal constant BPS = 10_000;

    enum Tranche { Senior, Junior }

    struct Init {
        address governor;
        address borrower;
        address asset;
        address book;
        address oracle;
        uint64 minPriceE8;
        uint64 maxOracleAge;
        uint16 advanceRateBps;
        uint16 maxLateBps;
        uint16 minJuniorBps;
        uint64 seniorAprBps;
        uint64 juniorAprBps;
    }

    struct PendingTerms {
        uint16 advanceRateBps;
        uint16 maxLateBps;
        uint16 minJuniorBps;
        uint64 seniorAprBps;
        uint64 juniorAprBps;
        uint64 eta;
        bool active;
    }

    FacilityMath.State internal acct;
    address public governor;
    address public pendingGovernor;
    address public borrower;
    address public asset;
    address public receivables;
    address public oracle;
    uint64 public minPriceE8;
    uint64 public maxOracleAge;
    PendingTerms internal pendingTerms;
    address public pendingBook;
    uint64 public bookEta;
    address public pendingOracle;
    uint64 public pendingMinPrice;
    uint64 public pendingMaxAge;
    uint64 public oracleEta;

    mapping(address => bool) public approvedLender;
    mapping(address => bool) public seenLender;
    uint256 public lenderCount;
    mapping(address => uint256) public seniorShares;
    mapping(address => uint256) public juniorShares;
    uint256 public seniorSupply;
    uint256 public juniorSupply;
    uint256 public seniorIndex;
    uint256 public juniorIndex;
    mapping(address => uint256) public seniorIndexOf;
    mapping(address => uint256) public juniorIndexOf;
    mapping(address => uint256) public seniorClaim;
    mapping(address => uint256) public juniorClaim;

    error Unauthorized();
    error BadParam();
    error Covenant();
    error NotRecovery();
    error SeniorFirst();
    error TrancheWiped();
    error Unclaimed();
    error LenderCap();
    error TooEarly();

    event GovernorSet(address indexed governor);
    event GovernorTransferStarted(address indexed pending);
    event LenderApproved(address indexed lender, bool approved);
    event Deposited(address indexed lender, Tranche tranche, uint256 assets, uint256 shares);
    event Redeemed(address indexed lender, Tranche tranche, uint256 shares, uint256 assets);
    event InterestPaid(address indexed lender, Tranche tranche, uint256 amount);
    event Drawn(address indexed borrower, uint256 amount);
    event Repaid(address indexed payer, uint256 amount);
    event RecoveryEntered(uint256 drawnAfter);
    event LossRecognized(uint256 amount);
    event TermsTightened(uint16 advanceRateBps, uint16 maxLateBps, uint16 minJuniorBps);
    event TermsScheduled(
        uint16 advanceRateBps, uint16 maxLateBps, uint16 minJuniorBps, uint64 seniorAprBps, uint64 juniorAprBps, uint64 eta
    );
    event TermsExecuted(
        uint16 advanceRateBps, uint16 maxLateBps, uint16 minJuniorBps, uint64 seniorAprBps, uint64 juniorAprBps
    );
    event TermsCancelled();
    event ResidualSwept(address indexed to, uint256 amount);
    event SurplusBooked(uint256 amount);

    function _init(Init memory init) internal {
        if (init.governor == address(0) || init.borrower == address(0) || init.asset == address(0)) revert BadParam();
        if (init.governor == init.borrower) revert BadParam();
        if (init.advanceRateBps > BPS || init.maxLateBps > BPS || init.minJuniorBps > BPS) revert BadParam();
        if (init.seniorAprBps > BPS || init.juniorAprBps > BPS) revert BadParam();
        governor = init.governor;
        borrower = init.borrower;
        asset = init.asset;
        receivables = init.book;
        oracle = init.oracle;
        minPriceE8 = init.minPriceE8;
        maxOracleAge = init.maxOracleAge;
        acct.advanceRateBps = init.advanceRateBps;
        acct.maxLateBps = init.maxLateBps;
        acct.minJuniorBps = init.minJuniorBps;
        acct.seniorAprBps = init.seniorAprBps;
        acct.juniorAprBps = init.juniorAprBps;
        acct.lastAccrual = uint64(block.timestamp);
        emit GovernorSet(init.governor);
    }

    function _onlyGovernor() internal view {
        if (msg.sender != governor) revert Unauthorized();
    }

    /// @dev The token balance must already equal `acct.cash`. A short delivery reverts.
    function _pull(uint256 amount) internal {
        IERC20 token = IERC20(asset);
        uint256 beforeBal = token.balanceOf(address(this));
        if (beforeBal != acct.cash) revert BadParam();
        token.safeTransferFrom(msg.sender, address(this), amount);
        uint256 afterBal = token.balanceOf(address(this));
        if (afterBal < beforeBal || afterBal - beforeBal != amount) revert BadParam();
    }

    /// @dev Callers reduce `acct.cash` by `amount` first. The recipient must receive `amount`.
    function _push(address to, uint256 amount) internal {
        IERC20 token = IERC20(asset);
        if (token.balanceOf(address(this)) != acct.cash + amount) revert BadParam();
        uint256 beforeTo = token.balanceOf(to);
        token.safeTransfer(to, amount);
        uint256 afterTo = token.balanceOf(to);
        if (afterTo < beforeTo || afterTo - beforeTo != amount) revert BadParam();
    }

    /// @notice Tokens above tracked cash become residual. A shortfall reverts and nothing is booked.
    function bookSurplus() external nonReentrant returns (uint256 extra) {
        uint256 bal = IERC20(asset).balanceOf(address(this));
        if (bal < acct.cash) revert BadParam();
        extra = bal - acct.cash;
        if (extra == 0) return 0;
        acct.cash += extra;
        acct.residual += extra;
        emit SurplusBooked(extra);
    }

    function _touch() internal {
        FacilityMath.accrue(acct, block.timestamp);
    }

    /// @notice Cash, drawn principal, interest, and the live terms.
    function accounting() external view returns (FacilityMath.State memory) {
        return acct;
    }

    /// @notice Cash plus drawn equals principal, interest cash, residual, and locked.
    function solvent() public view returns (bool) {
        return FacilityMath.solvent(acct);
    }

    /// @notice Advance rate times eligible receivables. An unreadable book is zero.
    function borrowingBase() public view returns (uint256) {
        (uint256 eligible,, bool ok) = _readBook();
        if (!ok) return 0;
        return Math.mulDiv(eligible, acct.advanceRateBps, BPS);
    }

    /// @notice Room under the borrowing base and the idle cash. Zero while a covenant is open.
    function availableDraw() public view returns (uint256) {
        if (acct.recovery || _breached()) return 0;
        uint256 base = borrowingBase();
        if (acct.drawn >= base) return 0;
        uint256 room = base - acct.drawn;
        uint256 liquid = FacilityMath.drawable(acct);
        return room < liquid ? room : liquid;
    }

    function _breached() internal view returns (bool) {
        (uint256 eligible, uint256 late, bool ok) = _readBook();
        if (!ok || _pegBad()) return true;
        uint256 total = eligible + late;
        if (total > 0 && late > Math.mulDiv(total, acct.maxLateBps, BPS)) return true;
        if (acct.drawn > Math.mulDiv(eligible, acct.advanceRateBps, BPS)) return true;
        uint256 capital = acct.seniorPrincipal + acct.juniorPrincipal;
        if (capital > 0 && acct.juniorPrincipal < Math.mulDiv(capital, acct.minJuniorBps, BPS)) return true;
        return false;
    }

    function _readBook() internal view returns (uint256 eligible, uint256 late, bool ok) {
        if (receivables == address(0)) return (0, 0, false);
        (bool okE, uint256 e) = _word(receivables, abi.encodeCall(IReceivablesBook.eligibleOutstanding, ()));
        if (!okE) return (0, 0, false);
        (bool okL, uint256 l) = _word(receivables, abi.encodeCall(IReceivablesBook.lateOutstanding, ()));
        if (!okL) return (0, 0, false);
        return (e, l, true);
    }

    /// @dev A short or reverting read is a failed word. `try/catch` does not trap a bad decode here.
    function _word(address target, bytes memory data) private view returns (bool ok, uint256 value) {
        (bool success, bytes memory ret) = target.staticcall(data);
        if (!success || ret.length < 32) return (false, 0);
        return (true, abi.decode(ret, (uint256)));
    }

    function _pegBad() internal view returns (bool) {
        if (oracle == address(0)) return false;
        (bool ok, bytes memory data) = oracle.staticcall(abi.encodeCall(IPegOracle.latest, ()));
        if (!ok || data.length < 64) return true;
        (uint256 price, uint256 updatedWord) = abi.decode(data, (uint256, uint256));
        if (updatedWord > type(uint64).max || price < minPriceE8) return true;
        uint64 updated = uint64(updatedWord);
        if (maxOracleAge == 0 || updated > block.timestamp || block.timestamp - updated > maxOracleAge) return true;
        return false;
    }

    function _count(address lender) internal {
        if (!approvedLender[lender]) revert Unauthorized();
        if (!seenLender[lender]) {
            if (lenderCount >= MAX_LENDERS) revert LenderCap();
            seenLender[lender] = true;
            lenderCount += 1;
        }
    }

    function _settle(address lender, bool senior) internal {
        uint256 shares = senior ? seniorShares[lender] : juniorShares[lender];
        uint256 index = senior ? seniorIndex : juniorIndex;
        uint256 cursor = senior ? seniorIndexOf[lender] : juniorIndexOf[lender];
        uint256 owed = Math.mulDiv(shares, index - cursor, RAY);
        if (senior) {
            seniorIndexOf[lender] = index;
            seniorClaim[lender] += owed;
        } else {
            juniorIndexOf[lender] = index;
            juniorClaim[lender] += owed;
        }
    }

    function _credit(bool senior, uint256 amount) internal {
        if (amount == 0) return;
        uint256 supply = senior ? seniorSupply : juniorSupply;
        if (supply == 0) {
            if (senior) acct.seniorInterestCash -= amount;
            else acct.juniorInterestCash -= amount;
            acct.residual += amount;
            return;
        }
        uint256 delta = Math.mulDiv(amount, RAY, supply);
        uint256 credited = Math.mulDiv(delta, supply, RAY);
        if (senior) {
            seniorIndex += delta;
            acct.seniorInterestCash -= amount - credited;
        } else {
            juniorIndex += delta;
            acct.juniorInterestCash -= amount - credited;
        }
        acct.residual += amount - credited;
    }

    function _lockOrphans() internal {
        if (seniorSupply == 0 && acct.seniorPrincipal > 0) {
            acct.locked += acct.seniorPrincipal;
            acct.seniorPrincipal = 0;
        }
        if (juniorSupply == 0 && acct.juniorPrincipal > 0) {
            acct.locked += acct.juniorPrincipal;
            acct.juniorPrincipal = 0;
        }
    }
}
