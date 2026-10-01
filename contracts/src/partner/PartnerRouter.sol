// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {AdvanceProposal} from "../interfaces/IAdvanceProposal.sol";
import {Advance, AdvanceStatus, RejectReason} from "./Types.sol";
import {IPartnerRouter} from "./interfaces/IPartnerRouter.sol";
import {IPartnerVault} from "./interfaces/IPartnerVault.sol";
import {RouterLogic} from "./libraries/RouterLogic.sol";

/// @title PartnerRouter
/// @notice Picks a partner vault for an exit and remembers who funded it.
/// @dev Immutable. No owner, no sweep, no upgrade. The only token movement is `relayRepay`,
///      which pulls from the caller and forwards the same amount to the vault that funded that exit.
contract PartnerRouter is IPartnerRouter, ReentrancyGuard {
    using SafeERC20 for IERC20;

    address[] public vaultList;
    mapping(address => uint256) public indexPlusOne;
    uint256 public rrCursor;
    mapping(bytes32 => Record[]) private _records;
    mapping(bytes32 => bool) private _seen;

    error NotOwner();
    error Registered();
    error UnknownVault();
    error Mismatch();
    error Duplicate();
    error BalanceMismatch();
    error Empty();

    event VaultRegistered(address indexed vault, address indexed partner);
    event VaultRemoved(address indexed vault);
    event ExitFunded(bytes32 indexed exitRef, address indexed vault, uint256 indexed advanceId, uint256 navValue, uint256 fee);
    event ExitRepaid(bytes32 indexed exitRef, address indexed vault, uint256 advanceId, uint256 amount);

    function register(address vault) external {
        if (indexPlusOne[vault] != 0) revert Registered();
        if (IPartnerVault(vault).owner() != msg.sender) revert NotOwner();
        vaultList.push(vault);
        indexPlusOne[vault] = vaultList.length;
        emit VaultRegistered(vault, msg.sender);
    }

    function remove(address vault) external {
        if (IPartnerVault(vault).owner() != msg.sender) revert NotOwner();
        uint256 idxPlus = indexPlusOne[vault];
        if (idxPlus == 0) revert UnknownVault();
        uint256 idx = idxPlus - 1;
        uint256 last = vaultList.length - 1;
        if (idx != last) {
            address moved = vaultList[last];
            vaultList[idx] = moved;
            indexPlusOne[moved] = idx + 1;
        }
        vaultList.pop();
        indexPlusOne[vault] = 0;
        emit VaultRemoved(vault);
    }

    function vaultCount() external view returns (uint256) {
        return vaultList.length;
    }

    /// @inheritdoc IPartnerRouter
    function quote(ExitRequest calldata request, Strategy strategy) external view returns (Slice[] memory) {
        if (request.navValue == 0) return new Slice[](0);
        RouterLogic.Candidate[] memory rows = _rows(request);
        if (strategy == Strategy.BestFee) {
            (RouterLogic.Slice memory pick, bool ok) = RouterLogic.best(rows, request.navValue);
            if (!ok) return new Slice[](0);
            Slice memory one = _toSlice(pick);
            if (!_accepted(one.vault, one, request)) return new Slice[](0);
            return _one(one);
        }
        if (strategy == Strategy.RoundRobin) {
            (RouterLogic.Slice memory pick,, bool ok) = RouterLogic.robin(rows, request.navValue, rrCursor);
            if (!ok) return new Slice[](0);
            Slice memory one = _toSlice(pick);
            if (!_accepted(one.vault, one, request)) return new Slice[](0);
            return _one(one);
        }
        return _filter(RouterLogic.proRata(rows, request.navValue), request);
    }

    /// @inheritdoc IPartnerRouter
    function notifyFunded(bytes32 exitRef, uint256 advanceId, address platform, uint256 navValue, uint256 fee)
        external
    {
        if (indexPlusOne[msg.sender] == 0) revert UnknownVault();
        Advance memory advance = IPartnerVault(msg.sender).getAdvance(advanceId);
        if (
            advance.exitRef != exitRef || advance.platform != platform || advance.navValue != navValue
                || advance.fee != fee || advance.status != AdvanceStatus.Active
        ) revert Mismatch();
        bytes32 key = keccak256(abi.encode(exitRef, msg.sender, advanceId));
        if (_seen[key]) revert Duplicate();
        _seen[key] = true;
        _records[exitRef].push(Record(msg.sender, advanceId, platform, navValue, fee));
        rrCursor = indexPlusOne[msg.sender];
        emit ExitFunded(exitRef, msg.sender, advanceId, navValue, fee);
    }

    /// @notice Pull `owed` from the caller and repay that exact advance. Keeps no balance.
    function relayRepay(bytes32 exitRef, uint256 recordIndex) external nonReentrant {
        Record memory record = _records[exitRef][recordIndex];
        uint256 owed = IPartnerVault(record.vault).owedOf(record.advanceId);
        if (owed == 0) revert Empty();
        IERC20 token = IERC20(IPartnerVault(record.vault).asset());
        uint256 beforeBal = token.balanceOf(address(this));
        token.safeTransferFrom(msg.sender, address(this), owed);
        if (token.balanceOf(address(this)) - beforeBal != owed) revert BalanceMismatch();
        token.forceApprove(record.vault, owed);
        IPartnerVault(record.vault).repay(record.advanceId);
        if (token.balanceOf(address(this)) != beforeBal) revert BalanceMismatch();
        token.forceApprove(record.vault, 0);
        emit ExitRepaid(exitRef, record.vault, record.advanceId, owed);
    }

    function recordsOf(bytes32 exitRef) external view returns (Record[] memory) {
        return _records[exitRef];
    }

    function _rows(ExitRequest calldata request) private view returns (RouterLogic.Candidate[] memory rows) {
        uint256 n = vaultList.length;
        rows = new RouterLogic.Candidate[](n);
        for (uint256 i; i < n; ++i) {
            address vault = vaultList[i];
            uint16 minFee = IPartnerVault(vault).mandate().minFeeBps;
            uint16 charged = request.feeBps > minFee ? request.feeBps : minFee;
            uint256 cap = IPartnerVault(vault).maxNav(request.platform, request.feeBps, request.dueAt);
            rows[i] = RouterLogic.Candidate(vault, cap, charged, IPartnerVault(vault).idle());
        }
    }

    function _filter(RouterLogic.Slice[] memory parts, ExitRequest calldata request)
        private
        view
        returns (Slice[] memory out)
    {
        uint256 n;
        Slice[] memory tmp = new Slice[](parts.length);
        for (uint256 i; i < parts.length; ++i) {
            Slice memory slice = _toSlice(parts[i]);
            if (_accepted(slice.vault, slice, request)) tmp[n++] = slice;
        }
        out = new Slice[](n);
        for (uint256 i; i < n; ++i) out[i] = tmp[i];
    }

    function _one(Slice memory slice) private pure returns (Slice[] memory out) {
        out = new Slice[](1);
        out[0] = slice;
    }

    function _toSlice(RouterLogic.Slice memory slice) private pure returns (Slice memory) {
        return Slice(slice.vault, slice.navValue, slice.fee, slice.feeBps);
    }

    /// @dev Drops slices the vault itself would reject, including a mismatched payout recipient.
    function _accepted(address vault, Slice memory slice, ExitRequest calldata request) private view returns (bool) {
        AdvanceProposal memory proposal = AdvanceProposal({
            platform: request.platform,
            recipient: request.recipient,
            requestId: 0,
            navValue: slice.navValue,
            fee: slice.fee,
            payout: slice.navValue - slice.fee,
            feeBps: slice.feeBps,
            dueAt: request.dueAt,
            expiresAt: uint64(block.timestamp),
            nonce: 0,
            quoteId: request.exitRef
        });
        return IPartnerVault(vault).preview(proposal) == RejectReason.None;
    }
}
