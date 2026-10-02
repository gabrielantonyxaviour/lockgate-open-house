// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ICreditSource} from "./ICreditSource.sol";

/// @notice Demo fund surface from the MVP spec. All three mock queue platforms implement it.
interface IIssuerFund is ICreditSource {
    enum RequestStatus { Queued, Advanced, Paid, Cancelled }

    struct Request {
        address owner;
        uint256 shares;
        uint256 navValue;
        uint64 requestedAt;
        RequestStatus status;
        uint256 advanceId;
    }

    /// @notice Share token. 18 decimals.
    function share() external view returns (address);

    /// @notice Account that sets the nav, the gate, and the allowlist.
    function issuer() external view returns (address);

    /// @notice Fund name.
    function name() external view returns (string memory);

    /// @notice Issuer. Zero reverts. Stamps `navUpdatedAt` to the current block.
    function setNav(uint256 newNav) external;

    /// @notice Issuer. Writes the gate. A closed gate blocks a new exit.
    function setGated(bool isGated) external;

    /// @notice Seconds added to `nextWindow` when a window clears Lockgate.
    function windowInterval() external view returns (uint64);

    /// @notice USDG held by this contract, including a direct transfer.
    function cash() external view returns (uint256);

    /// @notice Anyone. Pulls USDG and mints no shares.
    function depositCash(uint256 usdgAmount) external;

    /// @notice Pulls USDG and mints `usdgAmount * 1e18 / nav` shares. A banned account reverts `Blocked`. A first deposit joins the allowlist.
    function deposit(uint256 usdgAmount) external returns (uint256 sharesOut);

    /// @notice Prices `shares` at the current nav. Moves no tokens.
    function quoteExit(uint256 shares)
        external
        view
        returns (uint256 navValue, uint256 fee, uint256 usdgOut, bool available, string memory reason);

    /// @notice Prices a queued request. Any other status returns reason `not queued`.
    function quoteRequest(uint256 requestId)
        external
        view
        returns (uint256 navValue, uint256 fee, uint256 usdgOut, bool available, string memory reason);

    /// @notice Escrows the caller's shares. Reverts `Gated` while the gate is closed.
    function requestRedeem(uint256 shares) external returns (uint256 requestId);

    /// @notice Owner of a queued request. Draws the credit line and pays `nav - fee`.
    function exitEarly(uint256 requestId, uint256 minUsdgOut) external returns (uint256 usdgOut);

    /// @notice Queues `shares` and exits in the same call.
    function exitNow(uint256 shares, uint256 minUsdgOut) external returns (uint256 requestId, uint256 usdgOut);

    /// @notice Owner of a queued request. Returns the escrowed shares. An advanced request reverts `BadStatus`.
    function cancel(uint256 requestId) external;

    /// @notice Once `nextWindow` is due, repays open advances in order and stops at the first that does not fit. The window rolls, and the queue is paid, only when Lockgate is clear.
    function processWindow() external;

    /// @notice Stored request. Unknown ids are empty.
    function getRequest(uint256 id) external view returns (Request memory);

    /// @notice Request ids opened by `owner`, in request order.
    function requestsOf(address owner) external view returns (uint256[] memory);

    /// @notice Queued requests. An advanced request has left this count.
    function queueLength() external view returns (uint256);

    /// @notice Sum of queued requests' nav, in USDG units.
    function queuedValue() external view returns (uint256);

    /// @notice Highest request id. Cancelled and paid ids stay in this count.
    function requestCount() external view returns (uint256);

    /// @notice Issuer. `allowed` false blocks a later deposit from that account. A banned holder can still queue a redeem.
    function setAllowlist(address account, bool allowed) external;
}
