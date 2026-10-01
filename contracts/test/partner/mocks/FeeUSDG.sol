// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice USDG stand-in that keeps one percent of every transfer. Used only to prove pulls reject it.
contract FeeUSDG is ERC20 {
    constructor() ERC20("Fee USDG", "fUSDG") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function transfer(address to, uint256 value) public override returns (bool) {
        _take(msg.sender, to, value);
        return true;
    }

    function transferFrom(address from, address to, uint256 value) public override returns (bool) {
        _spendAllowance(from, msg.sender, value);
        _take(from, to, value);
        return true;
    }

    function _take(address from, address to, uint256 value) internal {
        uint256 fee = value / 100;
        if (fee == 0) fee = 1;
        if (fee >= value) revert("fee");
        _transfer(from, to, value - fee);
        _burn(from, fee);
    }
}
