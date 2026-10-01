// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "./IERC20.sol";

interface ILine {
    function draw(uint256 navValue, address to, uint256 maxFee) external returns (uint256 advanceId, uint256 fee);
    function repay(uint256 advanceId) external;
}

/// @title QueuePlatform
/// @notice Mock credit platform. kind 0 weekly, 1 epoch, 2 quarterly. Share balances do not transfer.
///         processWindow repays Lockgate for every advance before it pays the queue.
contract QueuePlatform {
    struct Request {
        address owner;
        uint256 shares;
        uint256 navValue;
        uint64 requestedAt;
        uint8 status; // 0 queued, 1 advanced, 2 paid, 3 cancelled
        uint256 advanceId;
    }

    IERC20 public immutable usdg;
    ILine public immutable creditLine;
    address public immutable router;
    address public issuer;
    string public platformName;
    uint8 public immutable kind;
    uint64 public windowInterval;
    uint64 public nextWindow;
    uint256 public nav;
    uint64 public navUpdatedAt;
    bool public gated;
    uint256 public cash;
    uint256 public requestCount;
    uint256[] public activeAdvances;

    mapping(address => uint256) public sharesOf;
    mapping(uint256 => Request) private _requests;

    error NotIssuer();
    error Gated();
    error Window();
    error BadRequest();
    error Slippage();
    error Cash();
    error Zero();

    event NavSet(uint256 nav, uint64 at);
    event GatedSet(bool gated);
    event SharesMinted(address indexed to, uint256 shares);
    event CashDeposited(address indexed from, uint256 amount);
    event InvestorPaid(address indexed to, uint256 amount);
    event RedeemQueued(uint256 indexed id, address indexed owner, uint256 shares, uint256 navValue);
    event Exited(uint256 indexed requestId, address indexed to, uint256 usdgOut, uint256 advanceId);
    event WindowProcessed(uint64 nextWindow, uint256 repaid, uint256 paidQueue);

    modifier onlyIssuer() {
        if (msg.sender != issuer) revert NotIssuer();
        _;
    }

    constructor(
        address usdg_,
        address creditLine_,
        address router_,
        address issuer_,
        string memory platformName_,
        uint8 kind_,
        uint64 windowInterval_,
        uint256 nav_
    ) {
        if (usdg_ == address(0) || creditLine_ == address(0) || router_ == address(0) || issuer_ == address(0)) revert Zero();
        if (windowInterval_ == 0 || nav_ == 0 || kind_ > 2) revert Zero();
        usdg = IERC20(usdg_);
        creditLine = ILine(creditLine_);
        router = router_;
        issuer = issuer_;
        platformName = platformName_;
        kind = kind_;
        windowInterval = windowInterval_;
        nav = nav_;
        navUpdatedAt = uint64(block.timestamp);
        nextWindow = uint64(block.timestamp) + windowInterval_;
        usdg.approve(creditLine_, type(uint256).max);
        usdg.approve(router_, type(uint256).max);
        emit NavSet(nav_, navUpdatedAt);
    }

    function setNav(uint256 next) external onlyIssuer {
        if (next == 0) revert Zero();
        nav = next;
        navUpdatedAt = uint64(block.timestamp);
        emit NavSet(next, navUpdatedAt);
    }

    function setGated(bool next) external onlyIssuer {
        gated = next;
        emit GatedSet(next);
    }

    function mintShares(address to, uint256 shares) external onlyIssuer {
        if (to == address(0) || shares == 0) revert Zero();
        sharesOf[to] += shares;
        emit SharesMinted(to, shares);
    }

    /// @notice Stands in for loans maturing into cash. Anyone may fund it.
    function depositCash(uint256 amount) external {
        if (amount == 0) revert Zero();
        usdg.transferFrom(msg.sender, address(this), amount);
        cash += amount;
        emit CashDeposited(msg.sender, amount);
    }

    /// @notice Forwards advance proceeds. Cannot spend cash that was booked for the queue.
    function payInvestor(address to, uint256 amount) external onlyIssuer {
        uint256 loose = usdg.balanceOf(address(this)) - cash;
        if (to == address(0) || amount == 0 || amount > loose) revert Cash();
        usdg.transfer(to, amount);
        emit InvestorPaid(to, amount);
    }

    function quoteExit(uint256 shares) external view returns (uint256 navValue, uint256 usdgOut) {
        navValue = shares * nav / 1e18;
        usdgOut = navValue;
    }

    function requestRedeem(uint256 shares) external returns (uint256 requestId) {
        if (gated) revert Gated();
        if (shares == 0 || sharesOf[msg.sender] < shares) revert BadRequest();
        sharesOf[msg.sender] -= shares;
        uint256 navValue = shares * nav / 1e18;
        requestId = ++requestCount;
        _requests[requestId] = Request({
            owner: msg.sender,
            shares: shares,
            navValue: navValue,
            requestedAt: uint64(block.timestamp),
            status: 0,
            advanceId: 0
        });
        emit RedeemQueued(requestId, msg.sender, shares, navValue);
    }

    function getRequest(uint256 id) external view returns (Request memory) { return _requests[id]; }

    /// @notice Issuer draws the credit line and pays `to`. The platform is the borrower.
    function drawTo(uint256 navValue, address to, uint256 maxFee) external onlyIssuer returns (uint256 advanceId, uint256 fee) {
        (advanceId, fee) = creditLine.draw(navValue, to, maxFee);
        activeAdvances.push(advanceId);
    }

    function exitNow(uint256 shares, uint256 minUsdgOut) external returns (uint256 requestId, uint256 usdgOut) {
        if (gated) revert Gated();
        if (shares == 0 || sharesOf[msg.sender] < shares) revert BadRequest();
        uint256 navValue = shares * nav / 1e18;
        sharesOf[msg.sender] -= shares;
        requestId = ++requestCount;
        (uint256 advanceId, uint256 fee) = creditLine.draw(navValue, msg.sender, navValue - minUsdgOut);
        usdgOut = navValue - fee;
        if (usdgOut < minUsdgOut) revert Slippage();
        activeAdvances.push(advanceId);
        _requests[requestId] = Request({
            owner: msg.sender,
            shares: shares,
            navValue: navValue,
            requestedAt: uint64(block.timestamp),
            status: 1,
            advanceId: advanceId
        });
        emit Exited(requestId, msg.sender, usdgOut, advanceId);
    }

    /// @notice Repays every recorded advance first, then pays queued redemptions FIFO from cash.
    function processWindow() external {
        if (block.timestamp < nextWindow) revert Window();
        uint256 repaid;
        uint256 kept;
        uint256 n = activeAdvances.length;
        for (uint256 i = 0; i < n; i++) {
            uint256 id = activeAdvances[i];
            uint256 beforeBal = usdg.balanceOf(address(this));
            try creditLine.repay(id) {
                repaid++;
                uint256 spent = beforeBal - usdg.balanceOf(address(this));
                cash = spent > cash ? 0 : cash - spent;
            } catch {
                activeAdvances[kept] = id;
                kept++;
            }
        }
        while (activeAdvances.length > kept) activeAdvances.pop();
        uint256 paid;
        for (uint256 id = 1; id <= requestCount; id++) {
            Request storage r = _requests[id];
            if (r.status != 0) continue;
            if (cash < r.navValue) break;
            cash -= r.navValue;
            r.status = 2;
            usdg.transfer(r.owner, r.navValue);
            paid++;
        }
        nextWindow = uint64(block.timestamp) + windowInterval;
        emit WindowProcessed(nextWindow, repaid, paid);
    }
}
