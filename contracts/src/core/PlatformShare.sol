// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice 18-decimal fund shares. The platform moves escrow without an allowance. Users transfer only on the allowlist.
contract PlatformShare is ERC20 {
    /// @notice Only this account may mint, burn, pull, and set the allowlist.
    address public immutable platform;
    /// @notice True when `account` may transfer shares.
    mapping(address => bool) public allowlist;

    error NotPlatform();
    error NotAllowlisted();
    error Blocked();
    error ZeroAddress();

    event AllowlistSet(address indexed account, bool allowed);

    /// @notice True when the issuer banned `account`. A later deposit reverts `Blocked`.
    mapping(address => bool) public blocked;

    modifier onlyPlatform() {
        if (msg.sender != platform) revert NotPlatform();
        _;
    }

    constructor(string memory name_, address platform_) ERC20(name_, "SHARE") {
        if (platform_ == address(0)) revert ZeroAddress();
        platform = platform_;
    }

    /// @notice 18 decimals.
    function decimals() public pure override returns (uint8) {
        return 18;
    }

    /// @notice Platform only. `allowed` false sets `blocked`, and a later deposit reverts.
    function setAllowlist(address account, bool allowed) external onlyPlatform {
        if (account == address(0)) revert ZeroAddress();
        allowlist[account] = allowed;
        blocked[account] = !allowed;
        emit AllowlistSet(account, allowed);
    }

    /// @notice A first deposit joins the allowlist. An issuer ban stays blocked.
    function mintDepositor(address to, uint256 amount) external onlyPlatform {
        if (blocked[to]) revert Blocked();
        if (!allowlist[to]) {
            allowlist[to] = true;
            emit AllowlistSet(to, true);
        }
        _mint(to, amount);
    }

    /// @notice Platform only. The recipient must already be on the allowlist.
    function mint(address to, uint256 amount) external onlyPlatform {
        if (!allowlist[to]) revert NotAllowlisted();
        _mint(to, amount);
    }

    /// @notice Platform only. Burns escrowed shares.
    function burn(address from, uint256 amount) external onlyPlatform {
        _burn(from, amount);
    }

    /// @notice Platform escrow. Does not check allowances.
    function pull(address from, address to, uint256 amount) external onlyPlatform {
        _transfer(from, to, amount);
    }

    function _update(address from, address to, uint256 value) internal override {
        if (from != address(0) && to != address(0) && msg.sender != platform) {
            if (!allowlist[from] || !allowlist[to]) revert NotAllowlisted();
        }
        super._update(from, to, value);
    }
}
