// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IIssuerFund} from "../interfaces/IIssuerFund.sol";
import {IQueueAdapter, QueueKind} from "../interfaces/IQueueAdapter.sol";
import {ILockgateCreditLine} from "../interfaces/ILockgateCreditLine.sol";
import {IPlatformReserve} from "../interfaces/IPlatformReserve.sol";
import {PlatformConfig} from "./PlatformConfig.sol";
import {PlatformShare} from "./PlatformShare.sol";

/// @notice State for a sandbox fund. Settlement behavior lives on `PlatformBase`.
abstract contract PlatformStore is ReentrancyGuard, IIssuerFund, IQueueAdapter {
    using SafeERC20 for IERC20;

    address public immutable token;
    ILockgateCreditLine public immutable line;
    PlatformShare public immutable shareToken;
    address public immutable issuer;
    uint64 public immutable windowInterval;

    string internal _fundName;
    uint256 public nav;
    uint64 public navUpdatedAt;
    bool public gated;
    uint64 public nextWindow;
    uint256 public currentCycleId = 1;
    uint256 public override(IIssuerFund, IQueueAdapter) queueLength;
    uint256 public override(IIssuerFund, IQueueAdapter) queuedValue;
    uint256 public requestCount;

    mapping(uint256 => Request) internal _requests;
    mapping(uint256 => uint256) public requestCycle;
    mapping(address => uint256[]) internal _owned;

    error NotIssuer();
    error NotOwner();
    error Gated();
    error ZeroAmount();
    error BadStatus();
    error WindowClosed();
    error WindowGated();
    error Slippage();
    error NotAvailable(string reason);
    error BadConfig();

    event NavUpdated(uint256 nav);
    event GateSet(bool gated);
    event CashDeposited(address indexed from, uint256 amount);
    event SharesDeposited(address indexed investor, uint256 shares, uint256 usdgAmount);
    event RedeemRequested(uint256 indexed id, address indexed owner, uint256 shares, uint256 navValue);
    event ExitAdvanced(uint256 indexed id, uint256 indexed advanceId, uint256 usdgOut, uint256 fee);
    event RequestCancelled(uint256 indexed id);
    event RequestPaid(uint256 indexed id, address indexed to, uint256 amount);
    event RequestPartPaid(uint256 indexed id, uint256 amount, uint256 remaining);
    event WindowProcessed(uint256 indexed cycleId, uint64 nextWindow, bool rolled);
    event AdvanceClosed(uint256 indexed requestId, uint256 indexed advanceId);

    modifier onlyIssuer() {
        if (msg.sender != issuer) revert NotIssuer();
        _;
    }

    constructor(PlatformConfig memory cfg) {
        if (cfg.token == address(0) || cfg.creditLine == address(0) || cfg.issuer == address(0)) revert BadConfig();
        if (cfg.nav == 0 || cfg.interval == 0) revert BadConfig();
        token = cfg.token;
        line = ILockgateCreditLine(cfg.creditLine);
        issuer = cfg.issuer;
        windowInterval = cfg.interval;
        _fundName = cfg.name;
        nav = cfg.nav;
        navUpdatedAt = uint64(block.timestamp);
        nextWindow = uint64(block.timestamp) + cfg.interval;
        shareToken = new PlatformShare(cfg.name, address(this));
        IERC20(cfg.token).forceApprove(cfg.creditLine, type(uint256).max);
        shareToken.setAllowlist(cfg.issuer, true);
        if (cfg.initialShares > 0) {
            if (cfg.initialHolder == address(0)) revert BadConfig();
            if (cfg.initialHolder != cfg.issuer) shareToken.setAllowlist(cfg.initialHolder, true);
            shareToken.mint(cfg.initialHolder, cfg.initialShares);
        }
        if (cfg.reserve != address(0)) IPlatformReserve(cfg.reserve).setAdmin(address(this), cfg.issuer);
    }

    function name() public view returns (string memory) {
        return _fundName;
    }

    function share() external view returns (address) {
        return address(shareToken);
    }

    function cycleLength() external view returns (uint64) {
        return windowInterval;
    }

    function cash() public view override(IIssuerFund, IQueueAdapter) returns (uint256) {
        return IERC20(token).balanceOf(address(this));
    }

    function kind() public pure virtual returns (QueueKind) {
        return QueueKind.WeeklyCycle;
    }
}
