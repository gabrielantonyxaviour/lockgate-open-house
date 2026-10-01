// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice 18-decimal fund shares. The platform moves escrow without an allowance. Users transfer only on the allowlist.
contract PlatformShare is ERC20 {
    address public immutable platform;
    mapping(address => bool) public allowlist;

    error NotPlatform();
    error NotAllowlisted();
    error ZeroAddress();

    event AllowlistSet(address indexed account, bool allowed);

    modifier onlyPlatform() {
        if (msg.sender != platform) revert NotPlatform();
        _;
    }

    constructor(string memory name_, address platform_) ERC20(name_, "SHARE") {
        if (platform_ == address(0)) revert ZeroAddress();
        platform = platform_;
    }

    function decimals() public pure override returns (uint8) {
        return 18;
    }

    function setAllowlist(address account, bool allowed) external onlyPlatform {
        if (account == address(0)) revert ZeroAddress();
        allowlist[account] = allowed;
        emit AllowlistSet(account, allowed);
    }

    function mint(address to, uint256 amount) external onlyPlatform {
        if (!allowlist[to]) revert NotAllowlisted();
        _mint(to, amount);
    }

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
