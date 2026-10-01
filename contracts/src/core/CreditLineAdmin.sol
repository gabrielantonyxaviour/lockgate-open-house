// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {ILockgateCreditLine} from "../interfaces/ILockgateCreditLine.sol";
import {IPlatformReserve} from "../interfaces/IPlatformReserve.sol";
import {IPricingEngine} from "../interfaces/IPricingEngine.sol";
import {IUsdgAdapter} from "../interfaces/IUsdgAdapter.sol";
import {UsdgTransfers} from "./UsdgTransfers.sol";

/// @notice Storage and owner controls for the stage-1 credit line. Draws live on `LockgateCreditLine`.
abstract contract CreditLineAdmin is Ownable, Pausable, ReentrancyGuard, ILockgateCreditLine {
    using SafeERC20 for IERC20;

    uint256 internal constant BPS = 10_000;

    address public immutable token;
    IPricingEngine public immutable pricing;
    IPlatformReserve public immutable reserveVault;

    uint64 public grace;
    uint16 public maxUtilizationBps;
    uint16 public maxConcentrationBps;
    uint256 public outstanding;
    uint256 public earnedFees;
    uint256 public deposited;
    uint256 public withdrawn;
    uint256 public totalExposure;
    uint256 public override eligibleOutstanding;
    uint256 public override lateOutstanding;
    uint256 public advanceCount;

    mapping(address => bool) public registrars;
    mapping(address => bool) public registered;
    mapping(address => bool) internal listed;
    mapping(address => uint256) public limitOf;
    mapping(address => uint16) public reserveBpsOf;
    mapping(address => uint16) public riskOf;
    mapping(address => uint256) internal _exposure;
    mapping(uint256 => Advance) internal _advances;
    mapping(uint256 => uint64) internal _graceOf;
    mapping(uint256 => uint256) public recoveredOf;
    mapping(address => uint256[]) internal _advanceIds;
    address[] internal _sources;

    error NotRegistrar();
    error Unregistered();
    error ZeroAddress();
    error ZeroAmount();
    error Gated();
    error WindowDue();
    error BadNavTime();
    error OverLimit();
    error ConcentrationCap();
    error UtilizationCap();
    error ReserveShort();
    error CapitalShort();
    error FeeConsumesValue();
    error StaleNav();
    error Tenor();
    error FeeAboveMax();
    error FeeTooHigh(uint256 fee, uint256 maxFee);
    error UnknownAdvance();
    error BadStatus();
    error TooEarly();
    error AlreadySettled();
    error AlreadyRegistered();
    error BadParam();
    error StillExposed();

    function paused() public view override(Pausable, ILockgateCreditLine) returns (bool) {
        return super.paused();
    }

    constructor(address owner_, address adapter, address pricing_, address reserve_) Ownable(owner_) {
        if (adapter == address(0) || pricing_ == address(0) || reserve_ == address(0)) revert ZeroAddress();
        token = IUsdgAdapter(adapter).token();
        pricing = IPricingEngine(pricing_);
        reserveVault = IPlatformReserve(reserve_);
        grace = 1 days;
        maxUtilizationBps = uint16(BPS);
        maxConcentrationBps = uint16(BPS);
        IERC20(token).forceApprove(reserve_, type(uint256).max);
    }

    /// @inheritdoc ILockgateCreditLine
    function registerSource(address source, uint256 limit, uint16 reserveBps_) external whenNotPaused {
        if (msg.sender != owner() && !registrars[msg.sender]) revert NotRegistrar();
        if (registered[source] && msg.sender != owner()) revert AlreadyRegistered();
        _setTerms(source, limit, reserveBps_, riskOf[source], true);
    }

    /// @inheritdoc ILockgateCreditLine
    function setSourceTerms(address source, uint256 limit, uint16 reserveBps_, uint16 riskBps) external onlyOwner {
        if (!registered[source]) revert Unregistered();
        _setTerms(source, limit, reserveBps_, riskBps, false);
    }

    /// @inheritdoc ILockgateCreditLine
    function deregisterSource(address source) external onlyOwner {
        if (!registered[source]) revert Unregistered();
        if (_exposure[source] != 0) revert StillExposed();
        registered[source] = false;
        emit SourceDeregistered(source);
    }

    /// @inheritdoc ILockgateCreditLine
    function setRegistrar(address registrar, bool allowed) external onlyOwner {
        if (registrar == address(0)) revert ZeroAddress();
        registrars[registrar] = allowed;
        emit RegistrarSet(registrar, allowed);
    }

    /// @inheritdoc ILockgateCreditLine
    function setGrace(uint64 grace_) external onlyOwner {
        grace = grace_;
        emit GraceSet(grace_);
    }

    /// @inheritdoc ILockgateCreditLine
    function setCaps(uint16 maxUtil, uint16 maxConc) external onlyOwner {
        if (maxUtil > BPS || maxConc > BPS) revert BadParam();
        maxUtilizationBps = maxUtil;
        maxConcentrationBps = maxConc;
        emit CapsSet(maxUtil, maxConc);
    }

    function pause() external onlyOwner { _pause(); }

    function unpause() external onlyOwner { _unpause(); }

    /// @inheritdoc ILockgateCreditLine
    function depositCapital(uint256 amount) external onlyOwner nonReentrant {
        if (amount == 0) revert ZeroAmount();
        deposited += amount;
        UsdgTransfers.pull(token, msg.sender, address(this), amount);
        emit CapitalDeposited(msg.sender, amount);
    }

    /// @inheritdoc ILockgateCreditLine
    function withdrawCapital(uint256 amount) external onlyOwner whenNotPaused nonReentrant {
        if (amount == 0) revert ZeroAmount();
        uint256 equity = deposited + earnedFees - withdrawn;
        uint256 free = equity > outstanding ? equity - outstanding : 0;
        if (amount > free) revert CapitalShort();
        withdrawn += amount;
        UsdgTransfers.push(token, msg.sender, amount);
        emit CapitalWithdrawn(msg.sender, amount);
    }

    /// @inheritdoc ILockgateCreditLine
    function postReserve(address source, uint256 amount) external nonReentrant {
        UsdgTransfers.pull(token, msg.sender, address(this), amount);
        reserveVault.post(source, amount);
    }

    function capital() public view returns (uint256) { return IERC20(token).balanceOf(address(this)); }

    function exposure(address source) external view returns (uint256) { return _exposure[source]; }

    function requiredReserve(address source) public view returns (uint256) {
        if (_exposure[source] == 0 || reserveBpsOf[source] == 0) return 0;
        return Math.mulDiv(_exposure[source], reserveBpsOf[source], BPS, Math.Rounding.Ceil);
    }

    function reserveOf(address source) external view returns (uint256) { return reserveVault.balanceOf(source); }

    function utilizationBps() public view returns (uint16) {
        uint256 denom = capital() + outstanding;
        if (denom == 0) return 0;
        uint256 bps = outstanding * BPS / denom;
        return bps > BPS ? uint16(BPS) : uint16(bps);
    }

    function sources() external view returns (address[] memory) { return _sources; }

    function getAdvance(uint256 id) external view returns (Advance memory) { return _advances[id]; }

    function advancesOf(address source) external view returns (uint256[] memory) { return _advanceIds[source]; }

    function remainingOf(uint256 id) external view returns (uint256) { return _remaining(id); }

    /// @inheritdoc ILockgateCreditLine
    function graceOf(uint256 id) external view returns (uint64) { return _graceOf[id]; }

    function accountedAssets() external view returns (uint256) { return capital() + outstanding; }

    function accountedEquity() external view returns (uint256) { return deposited + earnedFees - withdrawn; }

    function _remaining(uint256 id) internal view returns (uint256) {
        Advance storage advance = _advances[id];
        if (advance.source == address(0)) return 0;
        uint256 obligation = advance.principal + advance.fee;
        uint256 recovered = recoveredOf[id];
        return obligation > recovered ? obligation - recovered : 0;
    }

    function _setTerms(address source, uint256 limit, uint16 reserveBps_, uint16 riskBps, bool registering) internal {
        if (source == address(0)) revert ZeroAddress();
        if (reserveBps_ > BPS || riskBps > BPS) revert BadParam();
        if (!registered[source]) {
            registered[source] = true;
            if (!listed[source]) {
                listed[source] = true;
                _sources.push(source);
            }
        }
        limitOf[source] = limit;
        reserveBpsOf[source] = reserveBps_;
        riskOf[source] = riskBps;
        if (registering) emit SourceRegistered(source, limit, reserveBps_);
        emit SourceUpdated(source, limit, reserveBps_, riskBps);
    }
}
