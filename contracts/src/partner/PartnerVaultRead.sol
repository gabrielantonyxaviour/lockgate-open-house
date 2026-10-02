// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Initializable} from "@openzeppelin/contracts/proxy/utils/Initializable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts/proxy/utils/UUPSUpgradeable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {AdvanceProposal} from "../interfaces/IAdvanceProposal.sol";
import {Advance, MandateView, PlatformConfig, RejectReason} from "./Types.sol";
import {AdvanceProposalLib} from "../interfaces/AdvanceProposalLib.sol";
import {AdvanceHash} from "./libraries/AdvanceHash.sol";
import {FeeMath} from "./libraries/FeeMath.sol";
import {MandateLogic} from "./libraries/MandateLogic.sol";
import {VaultLayout} from "./libraries/VaultLayout.sol";
import {IPegOracle} from "./interfaces/IPegOracle.sol";

/// @title PartnerVaultRead
/// @notice Views and the mandate preview used by the router. No token movement.
abstract contract PartnerVaultRead is Initializable, UUPSUpgradeable, ReentrancyGuard {
    function _s() internal pure returns (VaultLayout.Layout storage) {
        return VaultLayout.layout();
    }

    /// @notice Partner who can move cash and set terms.
    function owner() public view returns (address) { return _s().owner; }
    /// @notice Nominee for a two-step ownership transfer. Address zero means none.
    function pendingOwner() external view returns (address) { return _s().pendingOwner; }
    /// @notice Token the vault holds.
    function asset() public view returns (address) { return _s().asset; }
    /// @notice Address whose signature must match the engine digest.
    function proposer() public view returns (address) { return _s().proposer; }
    /// @notice Extra partner signer. Address zero means the owner signs.
    function partnerSigner() public view returns (address) { return _s().partnerSigner; }
    /// @notice Module that may authorise an execute. Address zero means none.
    function autoModule() public view returns (address) { return _s().autoModule; }
    /// @notice Directory that records funded exits. Address zero means none.
    function router() external view returns (address) { return _s().router; }
    /// @notice Peg source. Address zero disables the price check.
    function pegOracle() external view returns (address) { return _s().pegOracle; }
    /// @notice Grace the next funded advance will store.
    function grace() external view returns (uint64) { return _s().grace; }

    /// @notice Grace stored when `advanceId` was funded. `grace()` is the value the next advance will store.
    ///         An id that was never funded returns 0, which is also a real pin, so read `getAdvance` first.
    function graceOf(uint256 advanceId) external view returns (uint64) {
        return _s().graceAtFunding[advanceId];
    }
    /// @notice When true, a new advance is rejected. Repayment still runs.
    function paused() public view returns (bool) { return _s().paused; }
    /// @notice Minimum wait after an upgrade is scheduled.
    function upgradeDelay() external view returns (uint64) { return _s().upgradeDelay; }
    /// @notice Implementation waiting out the delay. Address zero means none is scheduled.
    function scheduledImpl() external view returns (address) { return _s().scheduledImpl; }
    /// @notice Timestamp when the scheduled upgrade can run. Zero means none is scheduled.
    function scheduledEta() external view returns (uint64) { return _s().scheduledEta; }
    /// @notice Cash the owner can withdraw. Outstanding advances are not included.
    function idle() public view returns (uint256) { return _s().idleCash; }
    /// @notice First-loss cash posted across platforms.
    function reserveCash() public view returns (uint256) { return _s().reserveCash; }
    /// @notice Cash that has left the vault and is not yet back.
    function outstandingPrincipal() public view returns (uint256) { return _s().outstandingPrincipal; }
    /// @notice Shares minted to the partner.
    function totalShares() public view returns (uint256) { return _s().totalShares; }
    /// @notice Idle cash plus outstanding principal. Posted reserves are not included.
    function totalAssets() public view returns (uint256) { return _s().idleCash + _s().outstandingPrincipal; }
    /// @notice Unpaid nav for this platform.
    function exposureOf(address platform) public view returns (uint256) { return _s().exposureOf[platform]; }
    /// @notice First-loss posted for this platform.
    function reserveOf(address platform) public view returns (uint256) { return _s().reserveOfPlatform[platform]; }

    /// @notice Total shares for the current owner, and zero for everyone else.
    function sharesOf(address account) external view returns (uint256) {
        return account == _s().owner ? _s().totalShares : 0;
    }

    /// @notice Number of advances funded. Cancelled nonces are not included.
    function advanceCount() public view returns (uint256) { return _s().advanceSeq; }
    /// @notice Recipient that must match the proposal. Address zero means the platform itself.
    function payoutTo(address platform) external view returns (address) { return _s().payoutTo[platform]; }
    /// @notice Approved platforms, in the order they were approved.
    function approvedPlatforms() external view returns (address[] memory) { return _s().approvedList; }
    /// @notice True after execute, approve, or cancel of this nonce.
    function nonceUsed(uint256 nonce) external view returns (bool) { return _s().nonceUsed[nonce]; }
    /// @notice Engine digest filed for this nonce. Zero means none is filed.
    function proposalHashOf(uint256 nonce) external view returns (bytes32) { return _s().proposalHash[nonce]; }
    /// @notice Stored advance. An unknown id is an empty struct.
    function getAdvance(uint256 id) public view returns (Advance memory) { return _s().advances[id]; }
    /// @notice Amount still owed. Zero when the id is unknown or already cleared.
    function owedOf(uint256 id) public view returns (uint256) { return _s().advances[id].owed; }
    /// @notice EIP-712 domain separator for this vault and chain.
    function domainSeparator() external view returns (bytes32) {
        return AdvanceProposalLib.domainSeparator(block.chainid, address(this));
    }

    /// @notice Engine digest for this vault. Domain `LockgateAdvance`, version `1`.
    function hashTypedProposal(AdvanceProposal calldata proposal) external view returns (bytes32) {
        return AdvanceHash.digest(proposal);
    }

    /// @notice Fee floor, tenor cap, concentration, expiry, and the signer.
    function mandate() public view returns (MandateView memory m) {
        VaultLayout.Layout storage s = _s();
        m.partner = s.owner;
        m.signer = s.partnerSigner == address(0) ? s.owner : s.partnerSigner;
        m.minFeeBps = s.minFeeBps;
        m.maxTenor = s.maxTenor;
        m.concentrationBps = s.concentrationBps;
        m.expiry = s.expiry;
    }

    /// @notice Approval, limit, reserve rate, and gate for this platform.
    function platformConfig(address platform) public view returns (PlatformConfig memory) {
        return _s().platformOf[platform];
    }

    /// @notice Implementation version. This build returns 1.
    function vaultVersion() external pure virtual returns (uint256) { return 1; }

    /// @notice Mandate result for this proposal. `None` means the terms would fund.
    function preview(AdvanceProposal calldata proposal) external view returns (RejectReason) {
        return _preview(proposal);
    }

    /// @notice Largest nav fundable at `max(feeBps, mandate minimum)` for this due time.
    function maxNav(address platform, uint16 feeBps, uint64 dueAt) external view returns (uint256) {
        uint16 charged = feeBps > _s().minFeeBps ? feeBps : _s().minFeeBps;
        if (charged >= FeeMath.BPS) return 0;
        uint256 hi = _navUpper(platform, charged);
        uint256 lo;
        while (lo < hi) {
            uint256 mid = (lo + hi + 1) / 2;
            uint256 fee = FeeMath.mulDivHalfUp(mid, charged, FeeMath.BPS);
            if (fee < mid && _fits(platform, mid, fee, dueAt)) lo = mid;
            else hi = mid - 1;
        }
        return lo;
    }

    /// @notice Rounds down. An empty vault mints one share per unit of assets.
    function convertToShares(uint256 assets) public view returns (uint256) {
        uint256 supply = _s().totalShares;
        uint256 base = totalAssets();
        if (supply == 0 || base == 0) return assets;
        return Math.mulDiv(assets, supply, base);
    }

    /// @notice Rounds down. Withdraw burns shares rounded up, so the vault keeps the dust.
    function convertToAssets(uint256 shares) public view returns (uint256) {
        uint256 supply = _s().totalShares;
        if (supply == 0) return shares;
        return Math.mulDiv(shares, totalAssets(), supply);
    }

    /// @notice Idle the owner can withdraw. Zero for every other account.
    function maxWithdraw(address account) external view returns (uint256) {
        return account == _s().owner ? _s().idleCash : 0;
    }

    function _preview(AdvanceProposal memory p) internal view returns (RejectReason) {
        return MandateLogic.check(_input(p));
    }

    function _input(AdvanceProposal memory p) internal view returns (MandateLogic.Input memory input) {
        VaultLayout.Layout storage s = _s();
        PlatformConfig memory cfg = s.platformOf[p.platform];
        input.paused = s.paused;
        input.timestamp = block.timestamp;
        input.minFeeBps = s.minFeeBps;
        input.maxTenor = s.maxTenor;
        input.concentrationBps = s.concentrationBps;
        input.expiry = s.expiry;
        input.approved = cfg.approved;
        input.limit = cfg.limit;
        input.reserveBps = cfg.reserveBps;
        input.exposure = s.exposureOf[p.platform];
        input.reserve = s.reserveOfPlatform[p.platform];
        input.idle = s.idleCash;
        input.totalAssets = s.idleCash + s.outstandingPrincipal;
        input.platform = p.platform;
        input.recipient = p.recipient;
        input.payoutTo = s.payoutTo[p.platform];
        input.navValue = p.navValue;
        input.fee = p.fee;
        input.payout = p.payout;
        input.dueAt = p.dueAt;
        input.deadline = p.expiresAt;
        input.oracleReason = _oracleReason();
        input.gateReason = _gateReason(cfg, p.platform);
    }

    /// @dev Decode as raw words. `try/catch` does not trap a bad `uint64` or `bool` under this compiler.
    function _oracleReason() internal view returns (RejectReason) {
        VaultLayout.Layout storage s = _s();
        if (s.pegOracle == address(0)) return RejectReason.None;
        (bool ok, bytes memory data) = s.pegOracle.staticcall(abi.encodeCall(IPegOracle.latest, ()));
        if (!ok || data.length < 64) return RejectReason.StaleOracle;
        (uint256 price, uint256 updatedWord) = abi.decode(data, (uint256, uint256));
        if (updatedWord > type(uint64).max) return RejectReason.StaleOracle;
        uint64 updated = uint64(updatedWord);
        if (updated > block.timestamp || s.maxOracleAge == 0 || block.timestamp - updated > s.maxOracleAge) {
            return RejectReason.StaleOracle;
        }
        if (price < s.minPriceE8) return RejectReason.Peg;
        return RejectReason.None;
    }

    /// @dev A bool other than 0 or 1 is closed. A timestamp that does not fit in `uint64` is stale.
    function _gateReason(PlatformConfig memory cfg, address platform) internal view returns (RejectReason) {
        if (!cfg.checkGate) return RejectReason.None;
        (bool okG, bytes memory g) = platform.staticcall(abi.encodeWithSignature("gated()"));
        if (!okG || g.length < 32) return RejectReason.Gated;
        uint256 flag = abi.decode(g, (uint256));
        if (flag != 0) return RejectReason.Gated;
        (bool okN, bytes memory n) = platform.staticcall(abi.encodeWithSignature("navUpdatedAt()"));
        if (!okN || n.length < 32) return RejectReason.StaleNav;
        uint256 updatedWord = abi.decode(n, (uint256));
        if (updatedWord > type(uint64).max) return RejectReason.StaleNav;
        uint64 updated = uint64(updatedWord);
        if (cfg.maxNavAge == 0 || updated > block.timestamp || block.timestamp - updated > cfg.maxNavAge) {
            return RejectReason.StaleNav;
        }
        return RejectReason.None;
    }

    function _fits(address platform, uint256 nav, uint256 fee, uint64 dueAt) internal view returns (bool) {
        address to = _s().payoutTo[platform];
        AdvanceProposal memory p = AdvanceProposal({
            platform: platform,
            recipient: to == address(0) ? platform : to,
            requestId: 0,
            navValue: nav,
            fee: fee,
            payout: nav - fee,
            feeBps: 0,
            dueAt: dueAt,
            expiresAt: uint64(block.timestamp),
            nonce: 0,
            quoteId: bytes32(0)
        });
        return _preview(p) == RejectReason.None;
    }

    function _navUpper(address platform, uint16 charged) internal view returns (uint256 hi) {
        VaultLayout.Layout storage s = _s();
        uint256 exposure = s.exposureOf[platform];
        uint256 limit = s.platformOf[platform].limit;
        hi = limit > exposure ? limit - exposure : 0;
        uint256 cap = Math.mulDiv(s.idleCash + s.outstandingPrincipal, s.concentrationBps, FeeMath.BPS);
        uint256 concRoom = cap > exposure ? cap - exposure : 0;
        if (concRoom < hi) hi = concRoom;
        uint16 reserveBps = s.platformOf[platform].reserveBps;
        if (reserveBps > 0) {
            uint256 covered = Math.mulDiv(s.reserveOfPlatform[platform], FeeMath.BPS, reserveBps);
            uint256 reserveRoom = covered > exposure ? covered - exposure : 0;
            if (reserveRoom < hi) hi = reserveRoom;
        }
        uint256 cashNav = charged >= FeeMath.BPS ? 0 : Math.mulDiv(s.idleCash, FeeMath.BPS, FeeMath.BPS - charged);
        if (cashNav < hi) hi = cashNav;
    }
}
