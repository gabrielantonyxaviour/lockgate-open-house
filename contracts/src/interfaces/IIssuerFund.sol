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

    function share() external view returns (address);

    function issuer() external view returns (address);

    function name() external view returns (string memory);

    function setNav(uint256 newNav) external;

    function setGated(bool isGated) external;

    function windowInterval() external view returns (uint64);

    function cash() external view returns (uint256);

    function depositCash(uint256 usdgAmount) external;

    function deposit(uint256 usdgAmount) external returns (uint256 sharesOut);

    function quoteExit(uint256 shares)
        external
        view
        returns (uint256 navValue, uint256 fee, uint256 usdgOut, bool available, string memory reason);

    function quoteRequest(uint256 requestId)
        external
        view
        returns (uint256 navValue, uint256 fee, uint256 usdgOut, bool available, string memory reason);

    function requestRedeem(uint256 shares) external returns (uint256 requestId);

    function exitEarly(uint256 requestId, uint256 minUsdgOut) external returns (uint256 usdgOut);

    function exitNow(uint256 shares, uint256 minUsdgOut) external returns (uint256 requestId, uint256 usdgOut);

    function cancel(uint256 requestId) external;

    function processWindow() external;

    function getRequest(uint256 id) external view returns (Request memory);

    function requestsOf(address owner) external view returns (uint256[] memory);

    function queueLength() external view returns (uint256);

    function queuedValue() external view returns (uint256);

    function setAllowlist(address account, bool allowed) external;
}
