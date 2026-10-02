// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {AdvanceProposal} from "../interfaces/IAdvanceProposal.sol";
import {Advance, AdvanceStatus, RejectReason} from "./Types.sol";
import {IPartnerRouter} from "./interfaces/IPartnerRouter.sol";
import {IPartnerVault} from "./interfaces/IPartnerVault.sol";
import {FeeMath} from "./libraries/FeeMath.sol";
import {RouterLogic} from "./libraries/RouterLogic.sol";

/// @title PartnerRouter
/// @notice Picks a partner vault for an exit and remembers who funded it.
/// @dev Immutable. No owner, no sweep, no upgrade. The only token movement is `relayRepay`,
///      which pulls from the caller and forwards the same amount to the vault that funded that exit.
contract PartnerRouter is IPartnerRouter, ReentrancyGuard {
    using SafeERC20 for IERC20;

    /// @dev One registration cannot spend the block inside `quote`. An honest `maxNav` fits under this.
    uint256 internal constant PROBE_GAS = 2_500_000;

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
    error UnknownRecord();

    event VaultRegistered(address indexed vault, address indexed partner);
    event VaultRemoved(address indexed vault);
    event ExitFunded(bytes32 indexed exitRef, address indexed vault, uint256 indexed advanceId, uint256 navValue, uint256 fee);
    event ExitRepaid(bytes32 indexed exitRef, address indexed vault, uint256 advanceId, uint256 amount);

    /// @notice Partner lists a vault they own. A second listing reverts `Registered`.
    function register(address vault) external {
        if (indexPlusOne[vault] != 0) revert Registered();
        if (_owner(vault) != msg.sender) revert NotOwner();
        vaultList.push(vault);
        indexPlusOne[vault] = vaultList.length;
        emit VaultRegistered(vault, msg.sender);
    }

    /// @notice Owner takes the vault off the directory. Recorded repayments stay readable.
    function remove(address vault) external {
        if (_owner(vault) != msg.sender) revert NotOwner();
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

    /// @notice Number of vaults currently listed.
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
        (bool okAdvance, Advance memory advance) = _advance(msg.sender, advanceId);
        if (!okAdvance) revert Mismatch();
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
        Record[] storage rows = _records[exitRef];
        if (recordIndex >= rows.length) revert UnknownRecord();
        Record memory record = rows[recordIndex];
        (bool okOwed, uint256 owed) =
            _uint256Call(record.vault, abi.encodeWithSignature("owedOf(uint256)", record.advanceId));
        if (!okOwed) revert Mismatch();
        if (owed == 0) revert Empty();
        (bool okAsset, address asset) = _addressCall(record.vault, abi.encodeWithSignature("asset()"));
        if (!okAsset) revert Mismatch();
        IERC20 token = IERC20(asset);
        (bool okBefore, uint256 beforeBal) =
            _uint256Call(address(token), abi.encodeWithSignature("balanceOf(address)", address(this)));
        if (!okBefore) revert BalanceMismatch();
        token.safeTransferFrom(msg.sender, address(this), owed);
        (bool okAfter, uint256 afterBal) =
            _uint256Call(address(token), abi.encodeWithSignature("balanceOf(address)", address(this)));
        if (!okAfter || afterBal < beforeBal || afterBal - beforeBal != owed) revert BalanceMismatch();
        token.forceApprove(record.vault, owed);
        IPartnerVault(record.vault).repay(record.advanceId);
        (bool okEnd, uint256 endBal) =
            _uint256Call(address(token), abi.encodeWithSignature("balanceOf(address)", address(this)));
        if (!okEnd || endBal != beforeBal) revert BalanceMismatch();
        token.forceApprove(record.vault, 0);
        emit ExitRepaid(exitRef, record.vault, record.advanceId, owed);
    }

    /// @notice Funding records for one exit, in the order the vaults reported them.
    function recordsOf(bytes32 exitRef) external view returns (Record[] memory) {
        return _records[exitRef];
    }

    function _rows(ExitRequest calldata request) private view returns (RouterLogic.Candidate[] memory rows) {
        uint256 n = vaultList.length;
        rows = new RouterLogic.Candidate[](n);
        for (uint256 i; i < n; ++i) {
            rows[i] = _probe(vaultList[i], request);
        }
    }

    /// @dev A revert, an out-of-gas probe, or a `maxNav` above `uint128` leaves the vault ineligible.
    function _probe(address vault, ExitRequest calldata request) private view returns (RouterLogic.Candidate memory row) {
        row.vault = vault;
        row.feeBps = type(uint16).max;
        (bool okFee, uint16 minFee) = _minFee(vault);
        if (!okFee || minFee > FeeMath.BPS) return row;
        uint16 charged = request.feeBps > minFee ? request.feeBps : minFee;
        (bool okNav, uint256 cap) = _uint256Call(
            vault, abi.encodeWithSignature("maxNav(address,uint16,uint64)", request.platform, request.feeBps, request.dueAt)
        );
        if (!okNav || cap > type(uint128).max) return row;
        (bool okIdle, uint256 cash) = _uint256Call(vault, abi.encodeWithSignature("idle()"));
        if (!okIdle) return row;
        row.maxNav = cap;
        row.feeBps = charged;
        row.idle = cash;
    }

    function _minFee(address vault) private view returns (bool ok, uint16 fee) {
        (bool success, bytes memory ret) = vault.staticcall{gas: PROBE_GAS}(abi.encodeWithSignature("mandate()"));
        if (!success || ret.length < 192) return (false, 0);
        // `mandate()` word 2 is `minFeeBps`. The bytes header occupies the first 32 bytes.
        uint256 word;
        assembly {
            word := mload(add(ret, 96))
        }
        if (word > type(uint16).max) return (false, 0);
        return (true, uint16(word));
    }

    /// @dev `owner()` capped at `PROBE_GAS`. A state change, a short or long word, or dirty high bits is address zero.
    function _owner(address vault) private view returns (address owner_) {
        (bool ok, address account) = _addressCall(vault, abi.encodeWithSignature("owner()"));
        return ok ? account : address(0);
    }

    /// @dev One address word. Dirty high bits fail the read instead of panicking the caller.
    function _addressCall(address vault, bytes memory data) private view returns (bool ok, address account) {
        (bool success, uint256 word) = _uint256Call(vault, data);
        if (!success || word > type(uint160).max) return (false, address(0));
        return (true, address(uint160(word)));
    }

    /// @dev `Advance` is 13 static words. Any other shape, or a state change inside the probe, is a mismatch.
    function _advance(address vault, uint256 advanceId) private view returns (bool ok, Advance memory advance) {
        bytes memory ret;
        (ok, ret) = vault.staticcall{gas: PROBE_GAS}(abi.encodeCall(IPartnerVault.getAdvance, (advanceId)));
        if (!ok || ret.length != 416) return (false, advance);
        advance = abi.decode(ret, (Advance));
    }

    function _uint256Call(address vault, bytes memory data) private view returns (bool ok, uint256 value) {
        bytes memory ret;
        (ok, ret) = vault.staticcall{gas: PROBE_GAS}(data);
        // One word. A short or long return drops this vault instead of aborting the quote.
        if (!ok || ret.length != 32) return (false, 0);
        value = abi.decode(ret, (uint256));
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
    ///      A preview return that is not one word, or whose word is not `RejectReason.None`, drops that vault.
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
        (bool ok, bytes memory ret) = vault.staticcall{gas: PROBE_GAS}(abi.encodeCall(IPartnerVault.preview, (proposal)));
        if (!ok || ret.length != 32) return false;
        return abi.decode(ret, (uint256)) == uint256(RejectReason.None);
    }
}
