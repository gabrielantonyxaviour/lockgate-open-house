// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title IPartnerRouter
/// @notice Non-custodial directory. It records which vault funded an exit so repayment goes back there.
interface IPartnerRouter {
    enum Strategy {
        BestFee,
        ProRata,
        RoundRobin
    }

    struct ExitRequest {
        address platform;
        address recipient;
        uint256 navValue;
        uint16 feeBps;
        uint64 dueAt;
        bytes32 exitRef;
    }

    struct Slice {
        address vault;
        uint256 navValue;
        uint256 fee;
        uint16 feeBps;
    }

    struct Record {
        address vault;
        uint256 advanceId;
        address platform;
        uint256 navValue;
        uint256 fee;
    }

    /// @notice Vault reports an advance it just funded. The caller must be the registered vault.
    function notifyFunded(bytes32 exitRef, uint256 advanceId, address platform, uint256 navValue, uint256 fee)
        external;

    /// @notice Read-only selection. A vault that reverts or reports an absurd nav is skipped.
    function quote(ExitRequest calldata request, Strategy strategy) external view returns (Slice[] memory);

    /// @notice Funding records for one exit, in the order the vaults reported them.
    function recordsOf(bytes32 exitRef) external view returns (Record[] memory);
}
