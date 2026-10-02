// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IOpenCreditVault} from "../interfaces/IOpenCreditVault.sol";
import {IMockUSDG} from "../interfaces/IMockUSDG.sol";
import {UsdgTransfers} from "./UsdgTransfers.sol";

/// @title OpenCreditVault
/// @notice sUSDai-style sandbox. Share price starts at 1 USDG and, on MockUSDG, compounds the cash at 9% APR.
contract OpenCreditVault is ERC20, Ownable, ReentrancyGuard, IOpenCreditVault {
    /// @notice Mock yield, 900 bps a year. A real-USDG vault sets `mintYield` false.
    uint256 public constant APR_BPS = 900;
    /// @notice 10_000. One basis point is 1.
    uint256 public constant BPS = 10_000;
    /// @notice 31_536_000 seconds. Yield uses this day count.
    uint64 public constant YEAR = 31_536_000;
    /// @notice Share price before the first deposit. 1_000_000.
    uint256 public constant START_NAV = 1_000_000;

    /// @inheritdoc IOpenCreditVault
    address public immutable asset;
    /// @notice When true, accrual mints yield on the mock token.
    bool public immutable mintYield;

    /// @inheritdoc IOpenCreditVault
    uint64 public cooldown;
    /// @notice USDG backing shares. A requested withdrawal leaves this and enters `reserved`.
    uint256 public assets;
    /// @notice USDG owed to withdrawals that are not claimed yet.
    uint256 public reserved;
    /// @notice Last accrual timestamp. `navUpdatedAt` returns this.
    uint64 public navCheckpoint;
    /// @notice Highest withdrawal id.
    uint256 public withdrawalCount;

    struct Withdrawal {
        address owner;
        uint256 shares;
        uint256 usdg;
        uint64 readyAt;
        bool claimed;
    }

    /// @notice Stored withdrawal. Id 0 is empty.
    mapping(uint256 => Withdrawal) public withdrawals;

    error ZeroAddress();
    error ZeroAmount();
    error BadParam();
    error UnknownWithdrawal();
    error NotReady();
    error AlreadyClaimed();
    error Insolvent();

    event Deposited(address indexed account, uint256 usdg, uint256 shares);
    event YieldAccrued(uint256 amount);
    event WithdrawalRequested(uint256 indexed id, address indexed owner, uint256 shares, uint256 usdg, uint64 readyAt);
    event Claimed(uint256 indexed id, address indexed owner, uint256 usdg);
    event CooldownSet(uint64 cooldown);

    constructor(address owner_, address asset_, bool mintYield_) ERC20("Open credit token", "oUSDG") Ownable(owner_) {
        if (asset_ == address(0)) revert ZeroAddress();
        asset = asset_;
        mintYield = mintYield_;
        cooldown = 5 minutes;
        navCheckpoint = uint64(block.timestamp);
    }

    /// @notice 18 decimals.
    function decimals() public pure override returns (uint8) {
        return 18;
    }

    /// @inheritdoc IOpenCreditVault
    function nav() public view returns (uint256) {
        uint256 supply = totalSupply();
        if (supply == 0) return START_NAV;
        return (assets + _pending()) * 1e18 / supply;
    }

    /// @inheritdoc IOpenCreditVault
    function navUpdatedAt() external view returns (uint64) {
        return navCheckpoint;
    }

    /// @inheritdoc IOpenCreditVault
    function setCooldown(uint64 cooldown_) external onlyOwner {
        if (cooldown_ == 0) revert BadParam();
        cooldown = cooldown_;
        emit CooldownSet(cooldown_);
    }

    /// @inheritdoc IOpenCreditVault
    function accrue() public nonReentrant {
        _accrue();
    }

    /// @inheritdoc IOpenCreditVault
    function deposit(uint256 usdgAmount) external nonReentrant returns (uint256 shares) {
        _accrue();
        if (usdgAmount == 0) revert ZeroAmount();
        shares = usdgAmount * 1e18 / nav();
        if (shares == 0) revert ZeroAmount();
        assets += usdgAmount;
        UsdgTransfers.pull(asset, msg.sender, address(this), usdgAmount);
        _mint(msg.sender, shares);
        emit Deposited(msg.sender, usdgAmount, shares);
    }

    /// @inheritdoc IOpenCreditVault
    function requestWithdraw(uint256 shares) external nonReentrant returns (uint256 id) {
        _accrue();
        if (shares == 0) revert ZeroAmount();
        uint256 owed = shares * nav() / 1e18;
        if (owed == 0) revert ZeroAmount();
        if (owed > assets) revert Insolvent();
        assets -= owed;
        reserved += owed;
        _burn(msg.sender, shares);
        id = ++withdrawalCount;
        uint64 readyAt = uint64(block.timestamp) + cooldown;
        withdrawals[id] = Withdrawal(msg.sender, shares, owed, readyAt, false);
        emit WithdrawalRequested(id, msg.sender, shares, owed, readyAt);
    }

    /// @inheritdoc IOpenCreditVault
    function claim(uint256 id) external nonReentrant returns (uint256 usdgOut) {
        _accrue();
        Withdrawal storage item = withdrawals[id];
        if (item.owner == address(0)) revert UnknownWithdrawal();
        if (item.claimed) revert AlreadyClaimed();
        if (block.timestamp < item.readyAt) revert NotReady();
        item.claimed = true;
        usdgOut = item.usdg;
        reserved -= usdgOut;
        UsdgTransfers.push(asset, item.owner, usdgOut);
        emit Claimed(id, item.owner, usdgOut);
    }

    function _accrue() internal {
        uint256 yield = _pending();
        if (yield > 0) {
            IMockUSDG(asset).mint(address(this), yield);
            assets += yield;
        }
        uint64 nowStamp = uint64(block.timestamp);
        if (yield == 0 && navCheckpoint == nowStamp) return;
        navCheckpoint = nowStamp;
        emit YieldAccrued(yield);
    }

    function _pending() internal view returns (uint256) {
        if (!mintYield || assets == 0 || block.timestamp <= navCheckpoint) return 0;
        return assets * APR_BPS * (block.timestamp - navCheckpoint) / (BPS * uint256(YEAR));
    }
}
