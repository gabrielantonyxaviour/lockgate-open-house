// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Advance, PlatformConfig} from "../Types.sol";

/// @title VaultLayout
/// @notice ERC-7201 storage. Lockgate has no slot here. Privileged addresses start unset and only the partner writes them.
library VaultLayout {
    /// @dev keccak256(abi.encode(uint256(keccak256("lockgate.storage.PartnerVault")) - 1)) & ~bytes32(uint256(0xff))
    bytes32 internal constant SLOT = 0x2fc75087454a51da1b18917a7da83a2c64b5a904379c0641ed0092681b32be00;

    struct Layout {
        address owner;
        address pendingOwner;
        address asset;
        address proposer;
        address partnerSigner;
        address autoModule;
        address router;
        address pegOracle;
        uint64 minPriceE8;
        uint64 maxOracleAge;
        uint64 grace;
        uint64 upgradeDelay;
        address scheduledImpl;
        uint64 scheduledEta;
        bool paused;
        uint16 minFeeBps;
        uint64 maxTenor;
        uint16 concentrationBps;
        uint64 expiry;
        uint256 idleCash;
        uint256 reserveCash;
        uint256 outstandingPrincipal;
        uint256 totalShares;
        uint256 advanceSeq;
        address[] approvedList;
        mapping(address => uint256) approvedIndexPlus;
        mapping(address => PlatformConfig) platformOf;
        mapping(address => uint256) exposureOf;
        mapping(address => uint256) reserveOfPlatform;
        mapping(address => address) payoutTo;
        mapping(uint256 => bytes32) proposalHash;
        mapping(uint256 => bool) nonceUsed;
        mapping(uint256 => Advance) advances;
        /// @notice Grace captured when the advance was funded. A later `setGrace` cannot shorten it.
        mapping(uint256 => uint64) graceAtFunding;
        uint256[15] reserved;
    }

    function layout() internal pure returns (Layout storage s) {
        bytes32 slot = SLOT;
        assembly {
            s.slot := slot
        }
    }
}
