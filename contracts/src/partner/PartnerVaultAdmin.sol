// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {PlatformConfig, RejectReason} from "./Types.sol";
import {FeeMath} from "./libraries/FeeMath.sol";
import {VaultLayout} from "./libraries/VaultLayout.sol";
import {PartnerVaultRead} from "./PartnerVaultRead.sol";

/// @title PartnerVaultAdmin
/// @notice Partner-only controls. No function in this tree grants Lockgate a role.
abstract contract PartnerVaultAdmin is PartnerVaultRead {
    using SafeERC20 for IERC20;

    uint64 public constant MIN_UPGRADE_DELAY = 1 days;

    error Unauthorized();
    error ZeroAddress();
    error BadParam();
    error TooEarly();
    error UpgradeNotScheduled();
    error BalanceMismatch();
    error MandateRejected(RejectReason reason);
    error BadEngineSig();
    error NotApproved();
    error NonceUsed();
    error WrongVault();
    error NotSubmitted();
    error BadStatus();

    event OwnershipTransferStarted(address indexed current, address indexed pending);
    event OwnershipTransferred(address indexed previous, address indexed current);
    event ProposerSet(address indexed proposer);
    event PartnerSignerSet(address indexed signer);
    event AutoModuleSet(address indexed module);
    event RouterSet(address indexed router);
    event OracleSet(address indexed oracle, uint64 minPriceE8, uint64 maxOracleAge);
    event GraceSet(uint64 grace);
    event PausedSet(bool paused);
    event MandateGlobalsSet(uint16 minFeeBps, uint64 maxTenor, uint16 concentrationBps, uint64 expiry);
    event PlatformSet(address indexed platform, bool approved, uint256 limit, uint16 reserveBps, bool checkGate, uint64 maxNavAge);
    event PayoutSet(address indexed platform, address indexed to);
    event UpgradeScheduled(address indexed implementation, uint64 eta);
    event UpgradeCancelled();
    event UpgradeDelayIncreased(uint64 delay);

    function _onlyOwner() internal view {
        if (msg.sender != _s().owner) revert Unauthorized();
    }

    /// @notice Partner deploys the proxy and is the only owner. Proposer, signer and module start at zero.
    function initialize(address owner_, address asset_, uint64 upgradeDelay_, uint64 grace_) external initializer {
        if (owner_ == address(0) || asset_ == address(0)) revert ZeroAddress();
        if (upgradeDelay_ < MIN_UPGRADE_DELAY) revert BadParam();
        VaultLayout.Layout storage s = _s();
        s.owner = owner_;
        s.asset = asset_;
        s.upgradeDelay = upgradeDelay_;
        s.grace = grace_;
        emit OwnershipTransferred(address(0), owner_);
        emit UpgradeDelayIncreased(upgradeDelay_);
        emit GraceSet(grace_);
    }

    function transferOwnership(address next) external {
        _onlyOwner();
        if (next == address(0)) revert ZeroAddress();
        _s().pendingOwner = next;
        emit OwnershipTransferStarted(msg.sender, next);
    }

    function acceptOwnership() external {
        VaultLayout.Layout storage s = _s();
        if (msg.sender != s.pendingOwner) revert Unauthorized();
        address prev = s.owner;
        s.owner = msg.sender;
        s.pendingOwner = address(0);
        emit OwnershipTransferred(prev, msg.sender);
    }

    function setProposer(address proposer_) external {
        _onlyOwner();
        _s().proposer = proposer_;
        emit ProposerSet(proposer_);
    }

    function setPartnerSigner(address signer_) external {
        _onlyOwner();
        _s().partnerSigner = signer_;
        emit PartnerSignerSet(signer_);
    }

    function setAutoModule(address module_) external {
        _onlyOwner();
        _s().autoModule = module_;
        emit AutoModuleSet(module_);
    }

    function setRouter(address router_) external {
        _onlyOwner();
        _s().router = router_;
        emit RouterSet(router_);
    }

    function setOracle(address oracle_, uint64 minPriceE8_, uint64 maxOracleAge_) external {
        _onlyOwner();
        VaultLayout.Layout storage s = _s();
        s.pegOracle = oracle_;
        s.minPriceE8 = minPriceE8_;
        s.maxOracleAge = maxOracleAge_;
        emit OracleSet(oracle_, minPriceE8_, maxOracleAge_);
    }

    function setGrace(uint64 grace_) external {
        _onlyOwner();
        _s().grace = grace_;
        emit GraceSet(grace_);
    }

    function setPaused(bool paused_) external {
        _onlyOwner();
        _s().paused = paused_;
        emit PausedSet(paused_);
    }

    function setMandate(uint16 minFeeBps_, uint64 maxTenor_, uint16 concentrationBps_, uint64 expiry_) external {
        _onlyOwner();
        if (minFeeBps_ > FeeMath.BPS || concentrationBps_ > FeeMath.BPS) revert BadParam();
        VaultLayout.Layout storage s = _s();
        s.minFeeBps = minFeeBps_;
        s.maxTenor = maxTenor_;
        s.concentrationBps = concentrationBps_;
        s.expiry = expiry_;
        emit MandateGlobalsSet(minFeeBps_, maxTenor_, concentrationBps_, expiry_);
    }

    function setPlatform(
        address platform,
        bool approved,
        uint256 limit,
        uint16 reserveBps,
        bool checkGate,
        uint64 maxNavAge
    ) external {
        _onlyOwner();
        if (platform == address(0) || reserveBps > FeeMath.BPS) revert BadParam();
        VaultLayout.Layout storage s = _s();
        PlatformConfig storage cfg = s.platformOf[platform];
        if (approved && !cfg.approved) {
            s.approvedList.push(platform);
            s.approvedIndexPlus[platform] = s.approvedList.length;
        } else if (!approved && cfg.approved) {
            _removePlatform(s, platform);
        }
        cfg.approved = approved;
        cfg.limit = limit;
        cfg.reserveBps = reserveBps;
        cfg.checkGate = checkGate;
        cfg.maxNavAge = maxNavAge;
        emit PlatformSet(platform, approved, limit, reserveBps, checkGate, maxNavAge);
    }

    function setPayout(address platform, address to) external {
        _onlyOwner();
        _s().payoutTo[platform] = to;
        emit PayoutSet(platform, to);
    }

    function scheduleUpgrade(address implementation_) external {
        _onlyOwner();
        if (implementation_.code.length == 0) revert BadParam();
        VaultLayout.Layout storage s = _s();
        s.scheduledImpl = implementation_;
        s.scheduledEta = uint64(block.timestamp + s.upgradeDelay);
        emit UpgradeScheduled(implementation_, s.scheduledEta);
    }

    function cancelUpgrade() external {
        _onlyOwner();
        VaultLayout.Layout storage s = _s();
        s.scheduledImpl = address(0);
        s.scheduledEta = 0;
        emit UpgradeCancelled();
    }

    function increaseUpgradeDelay(uint64 delay_) external {
        _onlyOwner();
        VaultLayout.Layout storage s = _s();
        if (delay_ <= s.upgradeDelay) revert BadParam();
        s.upgradeDelay = delay_;
        emit UpgradeDelayIncreased(delay_);
    }

    function _authorizeUpgrade(address implementation_) internal view override {
        VaultLayout.Layout storage s = _s();
        if (msg.sender != s.owner) revert Unauthorized();
        if (implementation_ == address(0) || implementation_ != s.scheduledImpl) revert UpgradeNotScheduled();
        if (s.scheduledEta == 0 || block.timestamp < s.scheduledEta) revert TooEarly();
    }

    function _removePlatform(VaultLayout.Layout storage s, address platform) private {
        uint256 idxPlus = s.approvedIndexPlus[platform];
        if (idxPlus == 0) return;
        uint256 idx = idxPlus - 1;
        uint256 last = s.approvedList.length - 1;
        if (idx != last) {
            address moved = s.approvedList[last];
            s.approvedList[idx] = moved;
            s.approvedIndexPlus[moved] = idx + 1;
        }
        s.approvedList.pop();
        s.approvedIndexPlus[platform] = 0;
    }

    function _pull(address from, uint256 amount) internal {
        IERC20 token = IERC20(_s().asset);
        uint256 beforeBal = token.balanceOf(address(this));
        token.safeTransferFrom(from, address(this), amount);
        if (token.balanceOf(address(this)) - beforeBal != amount) revert BalanceMismatch();
    }

    function _push(address to, uint256 amount) internal {
        IERC20(_s().asset).safeTransfer(to, amount);
    }
}
