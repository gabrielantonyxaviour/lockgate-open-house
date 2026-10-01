// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Points the core at one 6-decimal USDG token: MockUSDG locally, or Paxos USDG on Arbitrum Sepolia.
/// @dev The adapter does not custody funds and is not an allowance spender. Contracts move tokens with
/// UsdgTransfers against `token()`, so users approve the credit line or the reserve, not this contract.
interface IUsdgAdapter {
    /// @notice Arbitrum Sepolia Paxos USDG proxy. Mainnet USDG is a different address and is out of scope.
    function ARBITRUM_SEPOLIA_USDG() external view returns (address);

    function token() external view returns (address);

    function decimals() external view returns (uint8);

    function isMock() external view returns (bool);

    function isCanonicalSepoliaUsdg() external view returns (bool);

    function balanceOf(address account) external view returns (uint256);
}
