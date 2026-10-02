// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Points the core at one 6-decimal USDG token: MockUSDG locally, or Paxos USDG on Arbitrum Sepolia.
/// @dev The adapter does not custody funds and is not an allowance spender. Contracts move tokens with
/// UsdgTransfers against `token()`, so users approve the credit line or the reserve, not this contract.
interface IUsdgAdapter {
    /// @notice Arbitrum Sepolia Paxos USDG proxy. Mainnet USDG is a different address and is out of scope.
    function ARBITRUM_SEPOLIA_USDG() external view returns (address);

    /// @notice USDG this adapter points at. The adapter holds none of it.
    function token() external view returns (address);

    /// @notice Always 6. The constructor rejects any other token.
    function decimals() external view returns (uint8);

    /// @notice True when this deployment was constructed as the test token.
    function isMock() external view returns (bool);

    /// @notice True when `token` is the Arbitrum Sepolia USDG proxy.
    function isCanonicalSepoliaUsdg() external view returns (bool);

    /// @notice `token` balance of `account`. This contract holds none of that balance.
    function balanceOf(address account) external view returns (uint256);
}
