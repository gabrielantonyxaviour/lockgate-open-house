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

    function owner() public view returns (address) { return _s().owner; }
    function pendingOwner() external view returns (address) { return _s().pendingOwner; }
    function asset() public view returns (address) { return _s().asset; }
    function proposer() public view returns (address) { return _s().proposer; }
    function partnerSigner() public view returns (address) { return _s().partnerSigner; }
    function autoModule() public view returns (address) { return _s().autoModule; }
    function router() external view returns (address) { return _s().router; }
    function pegOracle() external view returns (address) { return _s().pegOracle; }
    function grace() external view returns (uint64) { return _s().grace; }
    function paused() public view returns (bool) { return _s().paused; }
    function upgradeDelay() external view returns (uint64) { return _s().upgradeDelay; }
    function scheduledImpl() external view returns (address) { return _s().scheduledImpl; }
    function scheduledEta() external view returns (uint64) { return _s().scheduledEta; }
    function idle() public view returns (uint256) { return _s().idleCash; }
    function reserveCash() public view returns (uint256) { return _s().reserveCash; }
    function outstandingPrincipal() public view returns (uint256) { return _s().outstandingPrincipal; }
    function totalShares() public view returns (uint256) { return _s().totalShares; }
    function totalAssets() public view returns (uint256) { return _s().idleCash + _s().outstandingPrincipal; }
    function exposureOf(address platform) public view returns (uint256) { return _s().exposureOf[platform]; }
    function reserveOf(address platform) public view returns (uint256) { return _s().reserveOfPlatform[platform]; }

    function sharesOf(address account) external view returns (uint256) {
        return account == _s().owner ? _s().totalShares : 0;
    }

    function advanceCount() public view returns (uint256) { return _s().advanceSeq; }
    function payoutTo(address platform) external view returns (address) { return _s().payoutTo[platform]; }
    function approvedPlatforms() external view returns (address[] memory) { return _s().approvedList; }
    function nonceUsed(uint256 nonce) external view returns (bool) { return _s().nonceUsed[nonce]; }
    function proposalHashOf(uint256 nonce) external view returns (bytes32) { return _s().proposalHash[nonce]; }
    function getAdvance(uint256 id) public view returns (Advance memory) { return _s().advances[id]; }
    function owedOf(uint256 id) public view returns (uint256) { return _s().advances[id].owed; }
    function domainSeparator() external view returns (bytes32) {
        return AdvanceProposalLib.domainSeparator(block.chainid, address(this));
    }

    function hashTypedProposal(AdvanceProposal calldata proposal) external view returns (bytes32) {
        return AdvanceHash.digest(proposal);
    }

    function mandate() public view returns (MandateView memory m) {
        VaultLayout.Layout storage s = _s();
        m.partner = s.owner;
        m.signer = s.partnerSigner == address(0) ? s.owner : s.partnerSigner;
        m.minFeeBps = s.minFeeBps;
        m.maxTenor = s.maxTenor;
        m.concentrationBps = s.concentrationBps;
        m.expiry = s.expiry;
    }

    function platformConfig(address platform) public view returns (PlatformConfig memory) {
        return _s().platformOf[platform];
    }

    function vaultVersion() external pure virtual returns (uint256) { return 1; }

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

    function convertToShares(uint256 assets) public view returns (uint256) {
        uint256 supply = _s().totalShares;
        uint256 base = totalAssets();
        if (supply == 0 || base == 0) return assets;
        return Math.mulDiv(assets, supply, base);
    }

    function convertToAssets(uint256 shares) public view returns (uint256) {
        uint256 supply = _s().totalShares;
        if (supply == 0) return shares;
        return Math.mulDiv(shares, totalAssets(), supply);
    }

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

    function _oracleReason() internal view returns (RejectReason) {
        VaultLayout.Layout storage s = _s();
        if (s.pegOracle == address(0)) return RejectReason.None;
        (bool ok, bytes memory data) = s.pegOracle.staticcall(abi.encodeCall(IPegOracle.latest, ()));
        if (!ok || data.length < 64) return RejectReason.StaleOracle;
        (uint256 price, uint64 updated) = abi.decode(data, (uint256, uint64));
        if (updated > block.timestamp || s.maxOracleAge == 0 || block.timestamp - updated > s.maxOracleAge) {
            return RejectReason.StaleOracle;
        }
        if (price < s.minPriceE8) return RejectReason.Peg;
        return RejectReason.None;
    }

    function _gateReason(PlatformConfig memory cfg, address platform) internal view returns (RejectReason) {
        if (!cfg.checkGate) return RejectReason.None;
        (bool okG, bytes memory g) = platform.staticcall(abi.encodeWithSignature("gated()"));
        if (!okG || g.length < 32 || abi.decode(g, (bool))) return RejectReason.Gated;
        (bool okN, bytes memory n) = platform.staticcall(abi.encodeWithSignature("navUpdatedAt()"));
        if (!okN || n.length < 32) return RejectReason.StaleNav;
        uint64 updated = abi.decode(n, (uint64));
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
