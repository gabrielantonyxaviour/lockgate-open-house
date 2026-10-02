// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @notice Test USDG. 6 decimals. `faucet` is public and capped per call. `mint` is for the factory and the owner.
interface IMockUSDG is IERC20 {
    /// @notice 6 decimals.
    function decimals() external view returns (uint8);

    /// @notice Anyone. Reverts above `FAUCET_MAX` on this call.
    function faucet(uint256 amount) external;

    /// @notice Minters only.
    function mint(address to, uint256 amount) external;

    /// @notice True when `account` may call `mint`.
    function minters(address account) external view returns (bool);

    /// @notice Owner grants or revokes `mint`.
    function setMinter(address account, bool allowed) external;

    /// @notice Largest `faucet` call. 10_000 tokens.
    function FAUCET_MAX() external view returns (uint256);
}
