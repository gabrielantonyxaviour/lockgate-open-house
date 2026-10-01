// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Open token anyone can hold. 18-decimal shares. NAV is 6-decimal USDG per 1e18 shares.
///         On a mock token the vault mints about 9% a year into itself. Real USDG does not auto-mint.
interface IOpenCreditVault {
    function asset() external view returns (address);

    function nav() external view returns (uint256);

    function navUpdatedAt() external view returns (uint64);

    function cooldown() external view returns (uint64);

    function deposit(uint256 usdgAmount) external returns (uint256 shares);

    function requestWithdraw(uint256 shares) external returns (uint256 withdrawalId);

    function claim(uint256 withdrawalId) external returns (uint256 usdgOut);

    /// @notice Applies elapsed yield and refreshes `navUpdatedAt`. Permissionless.
    function accrue() external;

    function setCooldown(uint64 cooldown_) external;
}
