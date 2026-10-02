// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ICreditSource} from "../interfaces/ICreditSource.sol";
import {ILockgateExitPool} from "../interfaces/ILockgateExitPool.sol";
import {ILockgateCreditLine} from "../interfaces/ILockgateCreditLine.sol";
import {OpenCreditVault} from "./OpenCreditVault.sol";

/// @title LockgateExitPool
/// @custom:status NOT DEPLOYED, SUPERSEDED. Door 2 bought investor shares, which breaks "investor positions never move".
///                It is out of every deploy plan and demo; the source stays only for its existing unit tests.
/// @notice Buys open-token shares with the stage-1 credit line and holds the cooldown withdrawal.
///         Register this pool with `reserveBps` 0. `nextWindow` is `now + cooldown` at draw time.
contract LockgateExitPool is Ownable, ReentrancyGuard, ILockgateExitPool {
    using SafeERC20 for IERC20;

    /// @notice Open vault this pool buys and withdraws.
    OpenCreditVault public immutable vaultContract;
    /// @notice Credit line `sellToLockgate` draws.
    ILockgateCreditLine public immutable line;
    /// @notice USDG the vault holds.
    address public immutable token;

    /// @inheritdoc ICreditSource
    bool public gated;
    /// @inheritdoc ILockgateExitPool
    uint256 public positionCount;

    mapping(uint256 => Position) internal _positions;
    mapping(address => uint256[]) internal _owned;

    error ZeroAddress();
    error ZeroAmount();
    error Gated();
    error NotAvailable(string reason);
    error Slippage();
    error UnknownPosition();
    error NotReady();
    error AlreadySettled();

    event GatedSet(bool gated);
    event Sold(
        uint256 indexed positionId,
        address indexed seller,
        uint256 shares,
        uint256 navValue,
        uint256 fee,
        uint256 advanceId
    );
    event Settled(uint256 indexed positionId, uint256 advanceId, uint256 repaid);

    constructor(address owner_, address vault_, address line_) Ownable(owner_) {
        if (vault_ == address(0) || line_ == address(0)) revert ZeroAddress();
        vaultContract = OpenCreditVault(vault_);
        line = ILockgateCreditLine(line_);
        token = vaultContract.asset();
        IERC20(token).forceApprove(line_, type(uint256).max);
    }

    /// @inheritdoc ILockgateExitPool
    function vault() external view returns (address) {
        return address(vaultContract);
    }

    /// @inheritdoc ICreditSource
    function nav() external view returns (uint256) {
        return vaultContract.nav();
    }

    /// @notice Vault accrual timestamp. A sale accrues the vault before it draws.
    function navUpdatedAt() external view returns (uint64) {
        return vaultContract.navUpdatedAt();
    }

    /// @inheritdoc ILockgateExitPool
    function setGated(bool isGated) external onlyOwner {
        gated = isGated;
        emit GatedSet(isGated);
    }

    /// @notice Each draw is due when this sell's cooldown ends.
    function nextWindow() external view returns (uint64) {
        return uint64(block.timestamp) + vaultContract.cooldown();
    }

    /// @inheritdoc ILockgateExitPool
    function quote(uint256 shares)
        external
        view
        returns (uint256 navValue, uint256 fee, uint256 usdgOut, bool available, string memory reason)
    {
        if (gated) return (0, 0, 0, false, "gated");
        if (shares == 0) return (0, 0, 0, false, "zero");
        navValue = shares * vaultContract.nav() / 1e18;
        if (navValue == 0) return (0, 0, 0, false, "zero");
        (fee,, available, reason) = line.quote(address(this), navValue);
        if (!available) return (navValue, fee, 0, false, reason);
        return (navValue, fee, navValue - fee, true, "");
    }

    /// @inheritdoc ILockgateExitPool
    function sellToLockgate(uint256 shares, uint256 minUsdgOut)
        external
        nonReentrant
        returns (uint256 positionId, uint256 usdgOut)
    {
        if (gated) revert Gated();
        if (shares == 0) revert ZeroAmount();
        vaultContract.accrue();
        uint256 navValue = shares * vaultContract.nav() / 1e18;
        if (navValue == 0) revert ZeroAmount();
        (uint256 fee,, bool available, string memory reason) = line.quote(address(this), navValue);
        if (!available) revert NotAvailable(reason);
        usdgOut = navValue - fee;
        if (usdgOut < minUsdgOut) revert Slippage();
        IERC20(address(vaultContract)).safeTransferFrom(msg.sender, address(this), shares);
        (uint256 advanceId, uint256 charged) = line.draw(navValue, msg.sender, fee);
        uint256 withdrawalId = vaultContract.requestWithdraw(shares);
        positionId = ++positionCount;
        _positions[positionId] = Position({
            seller: msg.sender,
            shares: shares,
            navValue: navValue,
            fee: charged,
            withdrawalId: withdrawalId,
            advanceId: advanceId,
            readyAt: uint64(block.timestamp) + vaultContract.cooldown(),
            settled: false
        });
        _owned[msg.sender].push(positionId);
        emit Sold(positionId, msg.sender, shares, navValue, charged, advanceId);
    }

    /// @inheritdoc ILockgateExitPool
    function settle(uint256 positionId) external nonReentrant {
        Position storage position = _positions[positionId];
        if (position.seller == address(0)) revert UnknownPosition();
        if (position.settled) revert AlreadySettled();
        if (block.timestamp < position.readyAt) revert NotReady();
        vaultContract.claim(position.withdrawalId);
        line.repay(position.advanceId);
        position.settled = true;
        emit Settled(positionId, position.advanceId, position.navValue);
    }

    /// @inheritdoc ILockgateExitPool
    function positionsOf(address seller) external view returns (uint256[] memory) {
        return _owned[seller];
    }

    /// @inheritdoc ILockgateExitPool
    function getPosition(uint256 id) external view returns (Position memory) {
        return _positions[id];
    }
}
