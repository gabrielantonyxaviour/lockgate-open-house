// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Open token anyone can hold. 18-decimal shares. NAV is 6-decimal USDG per 1e18 shares.
///         On a mock token the vault mints about 9% a year into itself. Real USDG does not auto-mint.
interface IOpenCreditVault {
    /// @notice USDG this vault holds.
    function asset() external view returns (address);

    /// @notice 6-decimal USDG per 1e18 shares. An empty supply returns 1_000_000.
    function nav() external view returns (uint256);

    /// @notice Last accrual timestamp. `deposit`, `requestWithdraw`, `claim`, and `accrue` refresh it.
    function navUpdatedAt() external view returns (uint64);

    /// @notice Seconds a withdrawal waits before `claim`. The default is 5 minutes.
    function cooldown() external view returns (uint64);

    /// @notice Accrues, then mints `usdgAmount * 1e18 / nav` shares.
    function deposit(uint256 usdgAmount) external returns (uint256 shares);

    /// @notice Burns the caller's shares and reserves their nav. Reverts `Insolvent` when that nav exceeds assets.
    function requestWithdraw(uint256 shares) external returns (uint256 withdrawalId);

    /// @notice Pays the withdrawal's owner after `readyAt`. Anyone may call it.
    function claim(uint256 withdrawalId) external returns (uint256 usdgOut);

    /// @notice Applies elapsed yield and refreshes `navUpdatedAt`. Permissionless.
    function accrue() external;

    /// @notice Owner. Zero reverts. A withdrawal already requested keeps its `readyAt`.
    function setCooldown(uint64 cooldown_) external;
}
