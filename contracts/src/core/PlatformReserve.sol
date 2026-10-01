// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IPlatformReserve} from "../interfaces/IPlatformReserve.sol";
import {ILockgateCreditLine} from "../interfaces/ILockgateCreditLine.sol";
import {IUsdgAdapter} from "../interfaces/IUsdgAdapter.sol";
import {UsdgTransfers} from "./UsdgTransfers.sol";

/// @title PlatformReserve
/// @notice Per-platform first-loss USDG. The owner can name slashers. The owner cannot withdraw platform funds.
contract PlatformReserve is Ownable, ReentrancyGuard, IPlatformReserve {
    address public immutable asset;
    address public creditLine;
    uint256 public totalBalances;
    bool public slashersLocked;

    mapping(address => uint256) public balanceOf;
    mapping(address => address) public adminOf;
    mapping(address => bool) public isSlasher;

    error ZeroAddress();
    error ZeroAmount();
    error AlreadySet();
    error NotPlatform();
    error NotAdmin();
    error NotSlasher();
    error SlashersLocked();
    error ShortReserve(uint256 have, uint256 required_);

    event Posted(address indexed platform, address indexed from, uint256 amount);
    event Withdrawn(address indexed platform, address indexed to, uint256 amount);
    event Slashed(address indexed platform, address indexed to, uint256 amount);
    event AdminSet(address indexed platform, address indexed admin);
    event SlasherSet(address indexed slasher, bool allowed);
    event CreditLineSet(address indexed creditLine);
    event SlashersLockedSet();

    constructor(address owner_, address adapter) Ownable(owner_) {
        if (adapter == address(0)) revert ZeroAddress();
        asset = IUsdgAdapter(adapter).token();
    }

    /// @inheritdoc IPlatformReserve
    function setCreditLine(address line) external onlyOwner {
        if (line == address(0)) revert ZeroAddress();
        if (creditLine != address(0)) revert AlreadySet();
        creditLine = line;
        emit CreditLineSet(line);
    }

    /// @inheritdoc IPlatformReserve
    function setSlasher(address slasher, bool allowed) external onlyOwner {
        if (slashersLocked) revert SlashersLocked();
        if (slasher == address(0)) revert ZeroAddress();
        isSlasher[slasher] = allowed;
        emit SlasherSet(slasher, allowed);
    }

    /// @inheritdoc IPlatformReserve
    function lockSlasherSet() external onlyOwner {
        slashersLocked = true;
        emit SlashersLockedSet();
    }

    /// @inheritdoc IPlatformReserve
    function setAdmin(address platform, address admin) external {
        if (msg.sender != platform) revert NotPlatform();
        adminOf[platform] = admin;
        emit AdminSet(platform, admin);
    }

    /// @inheritdoc IPlatformReserve
    function post(address platform, uint256 amount) external nonReentrant {
        if (platform == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();
        balanceOf[platform] += amount;
        totalBalances += amount;
        UsdgTransfers.pull(asset, msg.sender, address(this), amount);
        emit Posted(platform, msg.sender, amount);
    }

    /// @inheritdoc IPlatformReserve
    function withdraw(address platform, uint256 amount) external nonReentrant {
        if (msg.sender != platform && msg.sender != adminOf[platform]) revert NotAdmin();
        if (amount == 0) revert ZeroAmount();
        uint256 next = balanceOf[platform] - amount;
        uint256 required_ = requiredOf(platform);
        if (next < required_) revert ShortReserve(next, required_);
        balanceOf[platform] = next;
        totalBalances -= amount;
        UsdgTransfers.push(asset, msg.sender, amount);
        emit Withdrawn(platform, msg.sender, amount);
    }

    /// @inheritdoc IPlatformReserve
    function slash(address platform, uint256 amount) external nonReentrant returns (uint256 slashed) {
        if (!isSlasher[msg.sender]) revert NotSlasher();
        uint256 bal = balanceOf[platform];
        slashed = amount > bal ? bal : amount;
        if (slashed == 0) {
            emit Slashed(platform, msg.sender, 0);
            return 0;
        }
        balanceOf[platform] = bal - slashed;
        totalBalances -= slashed;
        UsdgTransfers.push(asset, msg.sender, slashed);
        emit Slashed(platform, msg.sender, slashed);
    }

    /// @inheritdoc IPlatformReserve
    function requiredOf(address platform) public view returns (uint256) {
        if (creditLine == address(0)) return 0;
        return ILockgateCreditLine(creditLine).requiredReserve(platform);
    }

    function tokenBalance() external view returns (uint256) {
        return IERC20(asset).balanceOf(address(this));
    }
}
