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

    address public token;
    ILockgateCreditLine public line;
    PlatformShare public shareToken;
    address public issuer;
    uint64 public windowInterval;
    /// @dev Own slot. A packed write must not clear this lock.
    uint256 private configured;

    string internal _fundName;
    uint256 public nav;
    uint64 public navUpdatedAt;
    bool public gated;
    uint64 public nextWindow;
    uint256 public currentCycleId;
    uint256 public override(IIssuerFund, IQueueAdapter) queueLength;
    uint256 public override(IIssuerFund, IQueueAdapter) queuedValue;
    uint256 public requestCount;
    /// @notice Queued plus advanced requests. Settlement walks this list, not settled history.
    uint256 public constant MAX_OPEN = 128;
    uint256 public openCount;
    uint256 public firstOpen;
    uint256 internal lastOpen;

    mapping(uint256 => Request) internal _requests;
    mapping(uint256 => uint256) public nextOpen;
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
    error QueueFull();

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

    /// @dev `token == address(0)` locks this copy. Clones call `initialize` instead of running this body.
    constructor(PlatformConfig memory cfg) {
        if (cfg.token == address(0)) {
            configured = 1;
            return;
        }
        _init(cfg);
    }

    /// @notice Once, on a clone. Direct `new` already initializes in the constructor.
    ///         A clone skips field initializers, so `_init` sets the cycle id to 1.
    function initialize(PlatformConfig calldata cfg) external {
        if (configured != 0) revert BadConfig();
        _init(cfg);
    }

    function _init(PlatformConfig memory cfg) internal {
        if (configured != 0) revert BadConfig();
        if (cfg.token == address(0) || cfg.creditLine == address(0) || cfg.issuer == address(0)) revert BadConfig();
        if (cfg.nav == 0 || cfg.interval == 0) revert BadConfig();
        configured = 1;
        currentCycleId = 1;
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

    function _pushOpen(uint256 id) internal {
        if (openCount == MAX_OPEN) revert QueueFull();
        if (firstOpen == 0) firstOpen = id;
        else nextOpen[lastOpen] = id;
        lastOpen = id;
        openCount += 1;
    }

    function _removeOpen(uint256 id) internal {
        uint256 prev;
        uint256 cur = firstOpen;
        while (cur != 0 && cur != id) {
            prev = cur;
            cur = nextOpen[cur];
        }
        if (cur == 0) return;
        uint256 nxt = nextOpen[cur];
        if (prev == 0) firstOpen = nxt;
        else nextOpen[prev] = nxt;
        if (lastOpen == id) lastOpen = prev;
        nextOpen[id] = 0;
        openCount -= 1;
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
