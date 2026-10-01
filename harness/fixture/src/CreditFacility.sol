// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "./IERC20.sol";

interface IOutstanding {
    function outstanding() external view returns (uint256);
}

/// @title CreditFacility
/// @notice Stage 3 fixture. Institutions lend senior and junior USDG to Lockgate's own book.
///         Borrowing base is `advanceRateBps` of the credit line's outstanding advances.
///         Waterfall pays senior interest, senior principal, junior interest, then junior principal.
///         recognizeLoss writes junior principal down before senior. Rates are fixture constants.
contract CreditFacility {
    uint256 public constant YEAR = 365 days;

    IERC20 public immutable usdg;
    address public immutable borrower;
    IOutstanding public immutable creditLine;
    uint16 public immutable advanceRateBps;
    uint16 public immutable seniorAprBps;
    uint16 public immutable juniorAprBps;
    address public immutable senior;
    address public immutable junior;

    uint256 public seniorPrincipal;
    uint256 public juniorPrincipal;
    uint256 public seniorInterest;
    uint256 public juniorInterest;
    uint256 public drawn;
    uint64 public lastAccrual;

    error NotBorrower();
    error NotLender();
    error Base();
    error Cash();
    error Zero();

    event Deposited(address indexed who, bool seniorTranche, uint256 amount);
    event Drawn(address indexed to, uint256 amount, uint256 base);
    event Repaid(address indexed from, uint256 amount);
    event LossRecognized(uint256 juniorHit, uint256 seniorHit);
    event WaterfallPaid(address indexed to, uint256 amount, uint8 bucket);

    modifier onlyBorrower() {
        if (msg.sender != borrower) revert NotBorrower();
        _;
    }

    constructor(
        address usdg_,
        address borrower_,
        address creditLine_,
        uint16 advanceRateBps_,
        uint16 seniorAprBps_,
        uint16 juniorAprBps_,
        address senior_,
        address junior_
    ) {
        if (usdg_ == address(0) || borrower_ == address(0) || creditLine_ == address(0)) revert Zero();
        if (senior_ == address(0) || junior_ == address(0) || advanceRateBps_ > 10_000) revert Zero();
        usdg = IERC20(usdg_);
        borrower = borrower_;
        creditLine = IOutstanding(creditLine_);
        advanceRateBps = advanceRateBps_;
        seniorAprBps = seniorAprBps_;
        juniorAprBps = juniorAprBps_;
        senior = senior_;
        junior = junior_;
        lastAccrual = uint64(block.timestamp);
    }

    function borrowingBase() public view returns (uint256) {
        return creditLine.outstanding() * advanceRateBps / 10_000;
    }

    function breached() public view returns (bool) {
        return drawn > borrowingBase();
    }

    function depositSenior(uint256 amount) external {
        if (msg.sender != senior) revert NotLender();
        _deposit(true, amount);
    }

    function depositJunior(uint256 amount) external {
        if (msg.sender != junior) revert NotLender();
        _deposit(false, amount);
    }

    function draw(uint256 amount) external onlyBorrower {
        if (amount == 0) revert Zero();
        _accrue();
        uint256 base = borrowingBase();
        if (drawn + amount > base) revert Base();
        if (usdg.balanceOf(address(this)) < amount) revert Cash();
        drawn += amount;
        usdg.transfer(borrower, amount);
        emit Drawn(borrower, amount, base);
    }

    function repay(uint256 amount) external {
        if (amount == 0) revert Zero();
        _accrue();
        usdg.transferFrom(msg.sender, address(this), amount);
        uint256 toDrawn = amount > drawn ? drawn : amount;
        drawn -= toDrawn;
        emit Repaid(msg.sender, amount);
    }

    /// @notice Junior principal absorbs the loss before senior principal. `drawn` shrinks by the write-down.
    function recognizeLoss(uint256 amount) external onlyBorrower {
        if (amount == 0) revert Zero();
        _accrue();
        uint256 left = amount;
        uint256 j = juniorPrincipal < left ? juniorPrincipal : left;
        juniorPrincipal -= j;
        left -= j;
        uint256 s = seniorPrincipal < left ? seniorPrincipal : left;
        seniorPrincipal -= s;
        uint256 hit = j + s;
        if (drawn > hit) drawn -= hit;
        else drawn = 0;
        emit LossRecognized(j, s);
    }

    /// @notice Senior interest, senior principal, junior interest, junior principal.
    function waterfall() external {
        _accrue();
        uint256 cash = usdg.balanceOf(address(this));
        cash = _pay(senior, seniorInterest, cash, 0, true);
        cash = _pay(senior, seniorPrincipal, cash, 1, true);
        cash = _pay(junior, juniorInterest, cash, 2, false);
        _pay(junior, juniorPrincipal, cash, 3, false);
    }

    function _deposit(bool seniorTranche, uint256 amount) internal {
        if (amount == 0) revert Zero();
        _accrue();
        usdg.transferFrom(msg.sender, address(this), amount);
        if (seniorTranche) seniorPrincipal += amount;
        else juniorPrincipal += amount;
        emit Deposited(msg.sender, seniorTranche, amount);
    }

    function _accrue() internal {
        uint256 dt = block.timestamp - lastAccrual;
        lastAccrual = uint64(block.timestamp);
        if (dt == 0 || drawn == 0) return;
        uint256 seniorDrawn = drawn < seniorPrincipal ? drawn : seniorPrincipal;
        uint256 juniorDrawn = drawn > seniorDrawn ? drawn - seniorDrawn : 0;
        seniorInterest += seniorDrawn * seniorAprBps * dt / (YEAR * 10_000);
        juniorInterest += juniorDrawn * juniorAprBps * dt / (YEAR * 10_000);
    }

    function _pay(address to, uint256 bucket, uint256 cash, uint8 id, bool seniorBucket) internal returns (uint256) {
        uint256 amount = bucket < cash ? bucket : cash;
        if (amount == 0) return cash;
        if (seniorBucket) {
            if (id == 0) seniorInterest -= amount;
            else seniorPrincipal -= amount;
        } else {
            if (id == 2) juniorInterest -= amount;
            else juniorPrincipal -= amount;
        }
        usdg.transfer(to, amount);
        emit WaterfallPaid(to, amount, id);
        return cash - amount;
    }
}
