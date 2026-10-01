// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";

/// @title UsdgAdapter
/// @notice Binds Lockgate to one 6-decimal token. Swap MockUSDG for Arbitrum Sepolia USDG by deploying a new adapter.
contract UsdgAdapter {
    /// @notice Paxos USDG proxy on Arbitrum Sepolia (chain 421614). Not the Arbitrum One token.
    address public constant ARBITRUM_SEPOLIA_USDG = 0xFFC95faa3d63Cde504a05B567C600B78C0b41892;

    address public immutable token;
    bool public immutable isMock;

    error ZeroAddress();
    error BadDecimals(uint8 decimals);
    error CanonicalCannotBeMock();

    constructor(address token_, bool isMock_) {
        if (token_ == address(0)) revert ZeroAddress();
        uint8 decimals_ = IERC20Metadata(token_).decimals();
        if (decimals_ != 6) revert BadDecimals(decimals_);
        if (token_ == ARBITRUM_SEPOLIA_USDG && isMock_) revert CanonicalCannotBeMock();
        token = token_;
        isMock = isMock_;
    }

    function decimals() external pure returns (uint8) {
        return 6;
    }

    function isCanonicalSepoliaUsdg() external view returns (bool) {
        return token == ARBITRUM_SEPOLIA_USDG;
    }

    function balanceOf(address account) external view returns (uint256) {
        return IERC20(token).balanceOf(account);
    }
}
