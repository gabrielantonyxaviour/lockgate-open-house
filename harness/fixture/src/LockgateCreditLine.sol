// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "./IERC20.sol";

interface IPricing {
    function feeBps(uint256 secondsToWindow, uint256 navAge, bool gated, uint16 exposureBps, uint16 utilizationBps)
        external
        view
        returns (uint16 bps, bool available, string memory reason);
}

interface IPlatformView {
    function nav() external view returns (uint256);
    function navUpdatedAt() external view returns (uint64);
    function gated() external view returns (bool);
    function nextWindow() external view returns (uint64);
}

/// @title LockgateCreditLine
/// @notice Stage 1: Lockgate lends its own USDG to registered corporate platforms.
///         Draw sends navValue - fee. Repayment pulls navValue from the platform.
///         markLate covers from that platform's reserve. Lockgate is the only admin.
contract LockgateCreditLine {
    enum Status { Active, Repaid, Late }

    struct Advance {
        address source;
        address to;
        uint256 principal;
        uint256 fee;
        uint64 drawnAt;
        uint64 dueAt;
        Status status;
    }

    IERC20 public immutable usdg;
    IPricing public immutable engine;
    address public owner;
    uint64 public grace;
    bool public paused;

    uint256 public idle;
    uint256 public totalReserves;
    uint256 public outstanding;
    uint256 public earnedFees;
    uint256 public badDebt;
    uint256 public advanceCount;

    mapping(address => bool) public registered;
    mapping(address => uint256) public limitOf;
    mapping(address => uint16) public reserveBpsOf;
    mapping(address => uint256) public reserveOf;
    mapping(address => uint256) public exposureOf;
    mapping(uint256 => Advance) private _advances;
    address[] private _sources;

    error NotOwner();
    error Paused();
    error Registered();
    error Unknown();
    error BadStatus();
    error TooEarly();
    error Quote(string reason);
    error FeeCap();
    error Balance();
    error Zero();

    event OwnerSet(address indexed owner);
    event PausedSet(bool paused);
    event GraceSet(uint64 grace);
    event PlatformRegistered(address indexed platform, uint256 limit, uint16 reserveBps);
    event CapitalDeposited(address indexed from, uint256 amount);
    event CapitalWithdrawn(address indexed to, uint256 amount);
    event ReservePosted(address indexed platform, address indexed from, uint256 amount);
    event AdvanceDrawn(uint256 indexed id, address indexed source, address indexed to, uint256 principal, uint256 fee, uint64 dueAt);
    event AdvanceRepaid(uint256 indexed id, uint256 amount);
    event AdvanceLate(uint256 indexed id, uint256 covered, uint256 shortfall);

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    constructor(address usdg_, address engine_, address owner_, uint64 grace_) {
        if (usdg_ == address(0) || engine_ == address(0) || owner_ == address(0) || grace_ == 0) revert Zero();
        usdg = IERC20(usdg_);
        engine = IPricing(engine_);
        owner = owner_;
        grace = grace_;
        emit OwnerSet(owner_);
        emit GraceSet(grace_);
    }

    function setPaused(bool next) external onlyOwner {
        paused = next;
        emit PausedSet(next);
    }

    function transferOwnership(address next) external onlyOwner {
        if (next == address(0)) revert Zero();
        owner = next;
        emit OwnerSet(next);
    }

    function registerPlatform(address platform, uint256 limit, uint16 reserveBps) external onlyOwner {
        if (platform == address(0) || limit == 0 || reserveBps > 10_000) revert Zero();
        if (!registered[platform]) {
            registered[platform] = true;
            _sources.push(platform);
        }
        limitOf[platform] = limit;
        reserveBpsOf[platform] = reserveBps;
        emit PlatformRegistered(platform, limit, reserveBps);
    }

    function depositCapital(uint256 amount) external onlyOwner {
        if (amount == 0) revert Zero();
        usdg.transferFrom(msg.sender, address(this), amount);
        idle += amount;
        emit CapitalDeposited(msg.sender, amount);
    }

    function withdrawCapital(uint256 amount) external onlyOwner {
        if (amount == 0 || amount > idle) revert Balance();
        idle -= amount;
        usdg.transfer(msg.sender, amount);
        emit CapitalWithdrawn(msg.sender, amount);
    }

    function postReserve(address platform, uint256 amount) external {
        if (!registered[platform] || amount == 0) revert Unknown();
        usdg.transferFrom(msg.sender, address(this), amount);
        reserveOf[platform] += amount;
        totalReserves += amount;
        emit ReservePosted(platform, msg.sender, amount);
    }

    function capital() external view returns (uint256) { return idle; }

    function utilizationBps() public view returns (uint16) {
        uint256 denom = outstanding + idle;
        if (denom == 0) return 0;
        uint256 bps = outstanding * 10_000 / denom;
        return bps > 10_000 ? 10_000 : uint16(bps);
    }

    function sources() external view returns (address[] memory) { return _sources; }

    function getAdvance(uint256 id) external view returns (Advance memory) { return _advances[id]; }

    function balanced() external view returns (bool) {
        return usdg.balanceOf(address(this)) == idle + totalReserves;
    }

    function quote(address source, uint256 navValue)
        public
        view
        returns (uint256 fee, uint16 feeBps, bool available, string memory reason)
    {
        if (paused) return (0, 0, false, "paused");
        if (!registered[source]) return (0, 0, false, "unregistered");
        if (navValue == 0) return (0, 0, false, "zero");
        (uint256 wait, uint256 navAge, bool gated) = _platformState(source);
        uint256 limit = limitOf[source];
        uint16 exposureBps = limit == 0 ? 0 : uint16(_min(exposureOf[source] * 10_000 / limit, 10_000));
        (uint16 bps, bool ok, string memory why) = engine.feeBps(wait, navAge, gated, exposureBps, utilizationBps());
        if (!ok) return (0, bps, false, why);
        fee = navValue * bps / 10_000;
        if (fee >= navValue) return (fee, bps, false, "fee");
        if (idle < navValue - fee) return (fee, bps, false, "capital");
        if (exposureOf[source] + navValue > limit) return (fee, bps, false, "limit");
        uint256 need = (exposureOf[source] + navValue) * reserveBpsOf[source] / 10_000;
        if (reserveOf[source] < need) return (fee, bps, false, "reserve");
        return (fee, bps, true, "");
    }

    /// @notice Only the registered platform. Sends `navValue - fee` to `to`. Debt is `navValue`.
    function draw(uint256 navValue, address to, uint256 maxFee) external returns (uint256 advanceId, uint256 fee) {
        if (paused) revert Paused();
        if (!registered[msg.sender]) revert Unknown();
        (uint256 qFee, , bool ok, string memory why) = quote(msg.sender, navValue);
        if (!ok) revert Quote(why);
        if (qFee > maxFee) revert FeeCap();
        uint64 dueAt = IPlatformView(msg.sender).nextWindow();
        if (dueAt <= block.timestamp) revert TooEarly();
        fee = qFee;
        uint256 cashOut = navValue - fee;
        idle -= cashOut;
        exposureOf[msg.sender] += navValue;
        outstanding += navValue;
        advanceId = ++advanceCount;
        _advances[advanceId] = Advance({
            source: msg.sender,
            to: to,
            principal: cashOut,
            fee: fee,
            drawnAt: uint64(block.timestamp),
            dueAt: dueAt,
            status: Status.Active
        });
        usdg.transfer(to, cashOut);
        emit AdvanceDrawn(advanceId, msg.sender, to, cashOut, fee, dueAt);
    }

    /// @notice Pulls navValue from the platform that drew. Anyone may call.
    function repay(uint256 advanceId) external {
        Advance storage a = _advances[advanceId];
        if (a.status != Status.Active) revert BadStatus();
        uint256 owed = a.principal + a.fee;
        a.status = Status.Repaid;
        exposureOf[a.source] -= owed;
        outstanding -= owed;
        earnedFees += a.fee;
        idle += owed;
        usdg.transferFrom(a.source, address(this), owed);
        emit AdvanceRepaid(advanceId, owed);
    }

    /// @notice After dueAt + grace, the platform reserve covers the debt. Shortfall is bad debt.
    function markLate(uint256 advanceId) external {
        Advance storage a = _advances[advanceId];
        if (a.status != Status.Active) revert BadStatus();
        if (block.timestamp <= uint256(a.dueAt) + grace) revert TooEarly();
        uint256 owed = a.principal + a.fee;
        uint256 cover = reserveOf[a.source] < owed ? reserveOf[a.source] : owed;
        uint256 shortfall = owed - cover;
        a.status = Status.Late;
        reserveOf[a.source] -= cover;
        totalReserves -= cover;
        idle += cover;
        exposureOf[a.source] -= owed;
        outstanding -= owed;
        badDebt += shortfall;
        emit AdvanceLate(advanceId, cover, shortfall);
    }

    function _platformState(address source) internal view returns (uint256 wait, uint256 navAge, bool gated) {
        IPlatformView p = IPlatformView(source);
        uint64 next = p.nextWindow();
        wait = next > block.timestamp ? uint256(next) - block.timestamp : 0;
        uint64 updated = p.navUpdatedAt();
        navAge = block.timestamp > updated ? block.timestamp - updated : 0;
        gated = p.gated();
    }

    function _min(uint256 a, uint256 b) private pure returns (uint256) { return a < b ? a : b; }
}
