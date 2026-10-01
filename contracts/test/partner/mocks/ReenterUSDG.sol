// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice 6-decimal USDG stand-in. `hook` is called when tokens arrive there, so tests can reenter.
///         This file is not named MockUSDG.sol. Forge writes `out/<filename>/<contract>.json`, and
///         `src/core/MockUSDG.sol` uses that same filename. A second copy replaces the token the
///         Anvil flows deploy.
contract MockUSDG is ERC20 {
    address public hook;
    bool private _busy;

    constructor() ERC20("Test USDG", "USDG") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function setHook(address next) external {
        hook = next;
    }

    function _update(address from, address to, uint256 value) internal override {
        super._update(from, to, value);
        if (hook != address(0) && to == hook && !_busy) {
            _busy = true;
            (bool delivered,) = hook.call(abi.encodeWithSignature("onTokens()"));
            if (!delivered) return;
            _busy = false;
        }
    }
}
