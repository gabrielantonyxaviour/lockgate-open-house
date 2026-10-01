// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @notice Test USDG. 6 decimals. `faucet` is public and capped per call. `mint` is for the factory and the owner.
interface IMockUSDG is IERC20 {
    function decimals() external view returns (uint8);

    function faucet(uint256 amount) external;

    function mint(address to, uint256 amount) external;

    function minters(address account) external view returns (bool);

    function setMinter(address account, bool allowed) external;

    function FAUCET_MAX() external view returns (uint256);
}
