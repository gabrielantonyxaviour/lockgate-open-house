// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice First-loss USDG posted by a platform. Lockgate cannot withdraw it. A slasher can only pull it to itself.
interface IPlatformReserve {
    /// @notice USDG this reserve holds.
    function asset() external view returns (address);

    /// @notice Line whose `requiredReserve` sets the withdraw floor. The owner sets it once.
    function creditLine() external view returns (address);

    /// @notice USDG posted for this platform.
    function balanceOf(address platform) external view returns (uint256);

    /// @notice Sum of posted balances. A direct transfer sits outside this sum.
    function totalBalances() external view returns (uint256);

    /// @notice Account the platform named. The platform or this admin may withdraw surplus.
    function adminOf(address platform) external view returns (address);

    /// @notice True after `lockSlasherSet`. A later `setSlasher` reverts `SlashersLocked`.
    function slashersLocked() external view returns (bool);

    /// @notice Anyone may fund a platform's reserve. Tokens are pulled from `msg.sender`.
    function post(address platform, uint256 amount) external;

    /// @notice Platform contract or its admin. An amount above the posted balance reverts `OverBalance`. The rest cannot leave the balance under `requiredOf`.
    function withdraw(address platform, uint256 amount) external;

    /// @notice Slasher only. Sends `min(amount, balance)` to `msg.sender` and returns the amount moved.
    function slash(address platform, uint256 amount) external returns (uint256 slashed);

    /// @notice Credit line's `requiredReserve` for this platform. Zero before the line is set.
    function requiredOf(address platform) external view returns (uint256);

    /// @notice Owner, until `lockSlasherSet`. A slasher may pull a platform's reserve to itself.
    function setSlasher(address slasher, bool allowed) external;

    /// @notice Owner, once. A second call reverts `AlreadySet`.
    function setCreditLine(address line) external;

    /// @notice Owner, once. A second call reverts `SlashersLocked`.
    function lockSlasherSet() external;

    /// @notice Only the platform contract may name an admin.
    function setAdmin(address platform, address admin) external;
}
