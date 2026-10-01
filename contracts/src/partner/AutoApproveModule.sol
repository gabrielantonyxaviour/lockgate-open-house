// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {AdvanceProposal} from "../interfaces/IAdvanceProposal.sol";
import {FeeMath} from "./libraries/FeeMath.sol";
import {IPartnerVault} from "./interfaces/IPartnerVault.sol";

/// @title AutoApproveModule
/// @notice Partner-deployed robot. A relayer may call `execute`, but only inside bounds the partner set,
///         and the vault still enforces the mandate and the engine signature.
contract AutoApproveModule is ReentrancyGuard {
    struct Bounds {
        uint256 maxNavValue;
        uint256 dailyLimit;
        uint16 minFeeBps;
        uint64 maxTenor;
        bool enabled;
        bool allowlistEnabled;
        uint16 maxFeeBps;
    }

    address public owner;
    address public pendingOwner;
    address public immutable vault;
    uint256 public maxNavValue;
    uint256 public dailyLimit;
    uint16 public minFeeBps;
    uint64 public maxTenor;
    bool public enabled;
    bool public allowlistEnabled;
    uint16 public maxFeeBps;
    uint64 public windowStart;
    uint256 public windowUsed;
    mapping(address => bool) public allowedPlatform;

    error Unauthorized();
    error Disabled();
    error BoundsExceeded();
    error ZeroAddress();

    event OwnershipTransferStarted(address indexed pending);
    event OwnershipTransferred(address indexed previous, address indexed current);
    event BoundsSet(uint256 maxNavValue, uint256 dailyLimit, uint16 minFeeBps, uint16 maxFeeBps, uint64 maxTenor, bool enabled);
    event AllowlistSet(bool enabled);
    event PlatformAllowed(address indexed platform, bool allowed);
    event AutoExecuted(uint256 indexed nonce, uint256 navValue);

    constructor(address owner_, address vault_, Bounds memory bounds_) {
        if (owner_ == address(0) || vault_ == address(0)) revert ZeroAddress();
        owner = owner_;
        vault = vault_;
        _apply(bounds_);
        emit OwnershipTransferred(address(0), owner_);
    }

    function transferOwnership(address next) external {
        if (msg.sender != owner || next == address(0)) revert Unauthorized();
        pendingOwner = next;
        emit OwnershipTransferStarted(next);
    }

    function acceptOwnership() external {
        if (msg.sender != pendingOwner) revert Unauthorized();
        address prev = owner;
        owner = msg.sender;
        pendingOwner = address(0);
        emit OwnershipTransferred(prev, msg.sender);
    }

    function setBounds(Bounds calldata bounds_) external {
        if (msg.sender != owner) revert Unauthorized();
        _apply(bounds_);
    }

    function setAllowlist(bool enabled_) external {
        if (msg.sender != owner) revert Unauthorized();
        allowlistEnabled = enabled_;
        emit AllowlistSet(enabled_);
    }

    function setPlatformAllowed(address platform, bool allowed) external {
        if (msg.sender != owner) revert Unauthorized();
        allowedPlatform[platform] = allowed;
        emit PlatformAllowed(platform, allowed);
    }

    /// @notice Permissionless relayer entry. Authority is the partner's bounds, not the caller.
    function execute(AdvanceProposal calldata proposal, bytes calldata engineSig) external nonReentrant returns (uint256 id) {
        if (!enabled) revert Disabled();
        if (proposal.navValue == 0 || proposal.navValue > maxNavValue) revert BoundsExceeded();
        if (proposal.fee < FeeMath.minFee(proposal.navValue, minFeeBps)) revert BoundsExceeded();
        if (proposal.feeBps > maxFeeBps) revert BoundsExceeded();
        if (proposal.fee > FeeMath.mulDivHalfUp(proposal.navValue, maxFeeBps, FeeMath.BPS)) revert BoundsExceeded();
        if (proposal.dueAt <= block.timestamp || proposal.dueAt - block.timestamp > maxTenor) revert BoundsExceeded();
        if (allowlistEnabled && !allowedPlatform[proposal.platform]) revert BoundsExceeded();
        _consume(proposal.navValue);
        id = IPartnerVault(vault).execute(proposal, engineSig, "");
        emit AutoExecuted(proposal.nonce, proposal.navValue);
    }

    function _apply(Bounds memory bounds_) internal {
        if (bounds_.minFeeBps > FeeMath.BPS || bounds_.maxFeeBps > FeeMath.BPS) revert BoundsExceeded();
        if (bounds_.maxFeeBps < bounds_.minFeeBps) revert BoundsExceeded();
        maxNavValue = bounds_.maxNavValue;
        dailyLimit = bounds_.dailyLimit;
        minFeeBps = bounds_.minFeeBps;
        maxFeeBps = bounds_.maxFeeBps;
        maxTenor = bounds_.maxTenor;
        enabled = bounds_.enabled;
        if (allowlistEnabled != bounds_.allowlistEnabled) {
            allowlistEnabled = bounds_.allowlistEnabled;
            emit AllowlistSet(bounds_.allowlistEnabled);
        }
        emit BoundsSet(
            bounds_.maxNavValue, bounds_.dailyLimit, bounds_.minFeeBps, bounds_.maxFeeBps, bounds_.maxTenor, bounds_.enabled
        );
    }

    function _consume(uint256 navValue) internal {
        if (block.timestamp >= uint256(windowStart) + 1 days) {
            windowStart = uint64(block.timestamp);
            windowUsed = 0;
        }
        if (windowUsed + navValue > dailyLimit) revert BoundsExceeded();
        windowUsed += navValue;
    }
}
