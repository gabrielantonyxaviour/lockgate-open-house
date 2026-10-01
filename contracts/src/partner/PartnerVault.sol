// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {SignatureChecker} from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";
import {AdvanceProposal} from "../interfaces/IAdvanceProposal.sol";
import {Advance, AdvanceStatus, RejectReason} from "./Types.sol";
import {AdvanceHash} from "./libraries/AdvanceHash.sol";
import {FeeMath} from "./libraries/FeeMath.sol";
import {VaultLayout} from "./libraries/VaultLayout.sol";
import {IPartnerRouter} from "./interfaces/IPartnerRouter.sol";
import {PartnerVaultAdmin} from "./PartnerVaultAdmin.sol";

/// @title PartnerVault
/// @notice Single-owner ERC-4626-style accounting for one licensed partner.
/// @dev The partner deploys the proxy and holds every key. The engine signature is a proposal,
///      not authority: funds move only if the partner, their signer, their 1271 wallet, or their
///      auto-approve module also authorises that exact digest. Fees stay in the vault. Nothing
///      pays a Lockgate treasury. Upgrade is UUPS, timelocked, and partner-only.
contract PartnerVault is PartnerVaultAdmin {
    event Deposited(address indexed from, uint256 assets, uint256 shares);
    event Withdrawn(address indexed to, uint256 assets, uint256 shares);
    event Skimmed(uint256 amount);
    event ReservePosted(address indexed platform, address indexed from, uint256 amount);
    event ReserveWithdrawn(address indexed platform, address indexed to, uint256 amount);
    event ProposalSubmitted(uint256 indexed nonce, bytes32 digest);
    event ProposalCancelled(uint256 indexed nonce);
    event AdvanceFunded(
        uint256 indexed id, address indexed platform, address indexed recipient, uint256 navValue, uint256 fee, bytes32 exitRef
    );
    event AdvanceRepaid(uint256 indexed id, address indexed payer, uint256 amount);
    event AdvanceLate(uint256 indexed id, uint256 covered, uint256 shortfall);
    event AdvanceWrittenOff(uint256 indexed id, uint256 principalLost);

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /// @notice Partner deposits their own USDG. Share price rises when exit fees are repaid.
    function deposit(uint256 assets) external nonReentrant returns (uint256 shares) {
        if (msg.sender != _s().owner) revert Unauthorized();
        if (assets == 0) revert BadParam();
        _pull(msg.sender, assets);
        shares = convertToShares(assets);
        if (shares == 0) revert BadParam();
        VaultLayout.Layout storage s = _s();
        s.totalShares += shares;
        s.idleCash += assets;
        emit Deposited(msg.sender, assets, shares);
    }

    /// @notice Idle cash only. Outstanding advances stay in the vault until platforms repay.
    function withdraw(uint256 assets, address to) external nonReentrant returns (uint256 shares) {
        VaultLayout.Layout storage s = _s();
        if (msg.sender != s.owner) revert Unauthorized();
        if (to == address(0) || assets == 0 || assets > s.idleCash) revert BadParam();
        uint256 base = s.idleCash + s.outstandingPrincipal;
        shares = Math.mulDiv(assets, s.totalShares, base, Math.Rounding.Ceil);
        if (shares > s.totalShares) revert BadParam();
        s.totalShares -= shares;
        s.idleCash -= assets;
        _push(to, assets);
        emit Withdrawn(to, assets, shares);
    }

    /// @notice Donated tokens become partner yield. They are not a balance Lockgate can sweep.
    function skim() external nonReentrant returns (uint256 extra) {
        if (msg.sender != _s().owner) revert Unauthorized();
        VaultLayout.Layout storage s = _s();
        uint256 bal = IERC20Balance(s.asset);
        uint256 tracked = s.idleCash + s.reserveCash;
        if (bal < tracked) revert BalanceMismatch();
        extra = bal - tracked;
        s.idleCash += extra;
        emit Skimmed(extra);
    }

    function postReserve(address platform, uint256 amount) external nonReentrant {
        if (!_s().platformOf[platform].approved || amount == 0) revert BadParam();
        _pull(msg.sender, amount);
        VaultLayout.Layout storage s = _s();
        s.reserveOfPlatform[platform] += amount;
        s.reserveCash += amount;
        emit ReservePosted(platform, msg.sender, amount);
    }

    function withdrawReserve(address platform, uint256 amount, address to) external nonReentrant {
        if (msg.sender != platform || to == address(0) || amount == 0) revert Unauthorized();
        VaultLayout.Layout storage s = _s();
        uint256 next = s.reserveOfPlatform[platform] - amount;
        uint16 bps = s.platformOf[platform].reserveBps;
        if (bps > 0) {
            uint256 required = Math.mulDiv(s.exposureOf[platform], bps, FeeMath.BPS, Math.Rounding.Ceil);
            if (next < required) revert MandateRejected(RejectReason.Reserve);
        }
        s.reserveOfPlatform[platform] = next;
        s.reserveCash -= amount;
        _push(to, amount);
        emit ReserveWithdrawn(platform, to, amount);
    }

    /// @notice Engine files a signed proposal. Selector matches `submitProposal(AdvanceProposal,bytes)`.
    ///         This moves no tokens. The domain binds the signature to this vault.
    function submitProposal(AdvanceProposal calldata proposal, bytes calldata proposerSignature)
        external
        returns (bytes32 digest)
    {
        VaultLayout.Layout storage s = _s();
        if (s.nonceUsed[proposal.nonce] || s.proposalHash[proposal.nonce] != bytes32(0)) revert NonceUsed();
        digest = AdvanceHash.digest(proposal);
        if (!_signed(s.proposer, digest, proposerSignature)) revert BadEngineSig();
        s.proposalHash[proposal.nonce] = digest;
        emit ProposalSubmitted(proposal.nonce, digest);
    }

    function cancel(uint256 nonce) external {
        _onlyOwner();
        VaultLayout.Layout storage s = _s();
        if (s.nonceUsed[nonce]) revert NonceUsed();
        s.nonceUsed[nonce] = true;
        emit ProposalCancelled(nonce);
    }

    /// @notice Fund one exit. Requires the engine digest and a partner authorisation on top of it.
    function execute(AdvanceProposal calldata proposal, bytes calldata engineSig, bytes calldata partnerSig)
        external
        nonReentrant
        returns (uint256 advanceId)
    {
        VaultLayout.Layout storage s = _s();
        if (s.nonceUsed[proposal.nonce]) revert NonceUsed();
        bytes32 digest = AdvanceHash.digest(proposal);
        if (!_signed(s.proposer, digest, engineSig)) revert BadEngineSig();
        bytes32 filed = s.proposalHash[proposal.nonce];
        if (filed != bytes32(0) && filed != digest) revert NotSubmitted();
        _requirePartner(s, digest, partnerSig);
        RejectReason reason = _preview(proposal);
        if (reason != RejectReason.None) revert MandateRejected(reason);
        s.nonceUsed[proposal.nonce] = true;
        s.proposalHash[proposal.nonce] = digest;
        advanceId = _fund(proposal);
    }

    /// @notice Safe path: the signer calls after `submitProposal` verified the engine signature.
    function approve(AdvanceProposal calldata proposal) external nonReentrant returns (uint256 advanceId) {
        VaultLayout.Layout storage s = _s();
        if (msg.sender != s.owner && msg.sender != s.partnerSigner) revert NotApproved();
        if (s.nonceUsed[proposal.nonce]) revert NonceUsed();
        bytes32 digest = AdvanceHash.digest(proposal);
        if (s.proposalHash[proposal.nonce] != digest) revert NotSubmitted();
        RejectReason reason = _preview(proposal);
        if (reason != RejectReason.None) revert MandateRejected(reason);
        s.nonceUsed[proposal.nonce] = true;
        advanceId = _fund(proposal);
    }

    function repay(uint256 advanceId) external nonReentrant {
        Advance storage a = _s().advances[advanceId];
        if (a.status != AdvanceStatus.Active && a.status != AdvanceStatus.Late) revert BadStatus();
        uint256 due = a.owed;
        _pull(msg.sender, due);
        _reduce(a, due, false);
        a.status = AdvanceStatus.Repaid;
        emit AdvanceRepaid(advanceId, msg.sender, due);
    }

    function markLate(uint256 advanceId) external nonReentrant {
        VaultLayout.Layout storage s = _s();
        Advance storage a = s.advances[advanceId];
        if (a.status != AdvanceStatus.Active) revert BadStatus();
        if (block.timestamp < uint256(a.dueAt) + s.grace) revert TooEarly();
        uint256 cover = s.reserveOfPlatform[a.platform] < a.owed ? s.reserveOfPlatform[a.platform] : a.owed;
        if (cover > 0) _reduce(a, cover, true);
        uint256 shortfall = a.owed;
        a.status = shortfall == 0 ? AdvanceStatus.Repaid : AdvanceStatus.Late;
        emit AdvanceLate(advanceId, cover, shortfall);
    }

    /// @notice Partner books a loss on a late advance. This does not send tokens to anyone.
    function writeOff(uint256 advanceId) external nonReentrant {
        _onlyOwner();
        Advance storage a = _s().advances[advanceId];
        if (a.status != AdvanceStatus.Late) revert BadStatus();
        uint256 lost = a.principalRemaining;
        _dropExposure(a, a.owed, lost);
        a.principalRemaining = 0;
        a.feeRemaining = 0;
        a.owed = 0;
        a.status = AdvanceStatus.WrittenOff;
        emit AdvanceWrittenOff(advanceId, lost);
    }

    /// @notice Partner executes a previously scheduled implementation. Lockgate cannot call this.
    function executeUpgrade() external {
        _onlyOwner();
        address next = _s().scheduledImpl;
        upgradeToAndCall(next, "");
        VaultLayout.Layout storage s = _s();
        s.scheduledImpl = address(0);
        s.scheduledEta = 0;
    }

    function _requirePartner(VaultLayout.Layout storage s, bytes32 digest, bytes calldata partnerSig) internal view {
        if (msg.sender == s.owner || (s.partnerSigner != address(0) && msg.sender == s.partnerSigner)) return;
        if (s.autoModule != address(0) && msg.sender == s.autoModule) return;
        address signer = s.partnerSigner != address(0) ? s.partnerSigner : s.owner;
        if (!_signed(signer, digest, partnerSig)) revert NotApproved();
    }

    function _signed(address signer, bytes32 digest, bytes calldata signature) internal view returns (bool) {
        if (signer == address(0) || signature.length == 0) return false;
        return SignatureChecker.isValidSignatureNow(signer, digest, signature);
    }

    function _fund(AdvanceProposal calldata proposal) internal returns (uint256 id) {
        VaultLayout.Layout storage s = _s();
        uint256 principal = proposal.payout;
        id = ++s.advanceSeq;
        Advance storage a = s.advances[id];
        a.platform = proposal.platform;
        a.recipient = proposal.recipient;
        a.navValue = proposal.navValue;
        a.fee = proposal.fee;
        a.principal = principal;
        a.principalRemaining = principal;
        a.feeRemaining = proposal.fee;
        a.owed = proposal.navValue;
        a.fundedAt = uint64(block.timestamp);
        a.dueAt = proposal.dueAt;
        a.requestId = proposal.requestId;
        a.exitRef = proposal.quoteId;
        a.status = AdvanceStatus.Active;
        s.idleCash -= principal;
        s.outstandingPrincipal += principal;
        s.exposureOf[proposal.platform] += proposal.navValue;
        if (s.router != address(0)) {
            IPartnerRouter(s.router)
                .notifyFunded(proposal.quoteId, id, proposal.platform, proposal.navValue, proposal.fee);
        }
        _push(proposal.recipient, principal);
        emit AdvanceFunded(id, proposal.platform, proposal.recipient, proposal.navValue, proposal.fee, proposal.quoteId);
    }

    function _reduce(Advance storage a, uint256 amount, bool fromReserve) internal {
        VaultLayout.Layout storage s = _s();
        if (fromReserve) {
            s.reserveOfPlatform[a.platform] -= amount;
            s.reserveCash -= amount;
            s.idleCash += amount;
        } else {
            s.idleCash += amount;
        }
        uint256 feePay = amount < a.feeRemaining ? amount : a.feeRemaining;
        a.feeRemaining -= feePay;
        uint256 principalPay = amount - feePay;
        a.principalRemaining -= principalPay;
        a.owed -= amount;
        _dropExposure(a, amount, principalPay);
    }

    function _dropExposure(Advance storage a, uint256 navDrop, uint256 principalDrop) internal {
        VaultLayout.Layout storage s = _s();
        s.exposureOf[a.platform] -= navDrop;
        s.outstandingPrincipal -= principalDrop;
    }

    function IERC20Balance(address token) private view returns (uint256 bal) {
        (bool ok, bytes memory data) = token.staticcall(abi.encodeWithSignature("balanceOf(address)", address(this)));
        if (!ok || data.length < 32) revert BalanceMismatch();
        bal = abi.decode(data, (uint256));
    }
}
