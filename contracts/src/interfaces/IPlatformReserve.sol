// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice First-loss USDG posted by a platform. Lockgate cannot withdraw it. A slasher can only pull it to itself.
interface IPlatformReserve {
    function asset() external view returns (address);

    function creditLine() external view returns (address);

    function balanceOf(address platform) external view returns (uint256);

    function totalBalances() external view returns (uint256);

    function adminOf(address platform) external view returns (address);

    function slashersLocked() external view returns (bool);

    /// @notice Anyone may fund a platform's reserve. Tokens are pulled from `msg.sender`.
    function post(address platform, uint256 amount) external;

    /// @notice Platform contract or its admin. Cannot reduce the balance below `requiredOf`.
    function withdraw(address platform, uint256 amount) external;

    /// @notice Slasher only. Sends `min(amount, balance)` to `msg.sender` and returns the amount moved.
    function slash(address platform, uint256 amount) external returns (uint256 slashed);

    function requiredOf(address platform) external view returns (uint256);

    function setSlasher(address slasher, bool allowed) external;

    function setCreditLine(address line) external;

    function lockSlasherSet() external;

    /// @notice Only the platform contract may name an admin.
    function setAdmin(address platform, address admin) external;
}
