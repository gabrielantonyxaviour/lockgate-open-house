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
    event UpgradeExecuted(address indexed implementation);
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

    /// @notice Starts a two-step owner change. The vault keeps the current owner until `acceptOwnership`.
    function transferOwnership(address next) external {
        _onlyOwner();
        if (next == address(0)) revert ZeroAddress();
        _s().pendingOwner = next;
        emit OwnershipTransferStarted(msg.sender, next);
    }

    /// @notice Pending owner becomes the only address that can move idle cash.
    function acceptOwnership() external {
        VaultLayout.Layout storage s = _s();
        if (msg.sender != s.pendingOwner) revert Unauthorized();
        address prev = s.owner;
        s.owner = msg.sender;
        s.pendingOwner = address(0);
        emit OwnershipTransferred(prev, msg.sender);
    }

    /// @notice Engine address whose signature can file a proposal. It cannot move funds by itself.
    function setProposer(address proposer_) external {
        _onlyOwner();
        _s().proposer = proposer_;
        emit ProposerSet(proposer_);
    }

    /// @notice Second partner key that may `execute` or `approve`. Address zero clears it.
    function setPartnerSigner(address signer_) external {
        _onlyOwner();
        _s().partnerSigner = signer_;
        emit PartnerSignerSet(signer_);
    }

    /// @notice Partner-deployed module that may `execute` with an empty partner signature.
    function setAutoModule(address module_) external {
        _onlyOwner();
        _s().autoModule = module_;
        emit AutoModuleSet(module_);
    }

    /// @notice Directory told about each funded exit. Address zero stops those notifications.
    function setRouter(address router_) external {
        _onlyOwner();
        _s().router = router_;
        emit RouterSet(router_);
    }

    /// @notice Peg oracle. Address zero disables the check.
    function setOracle(address oracle_, uint64 minPriceE8_, uint64 maxOracleAge_) external {
        _onlyOwner();
        VaultLayout.Layout storage s = _s();
        s.pegOracle = oracle_;
        s.minPriceE8 = minPriceE8_;
        s.maxOracleAge = maxOracleAge_;
        emit OracleSet(oracle_, minPriceE8_, maxOracleAge_);
    }

    /// @notice Grace the next advance will store. Outstanding advances keep the old value.
    function setGrace(uint64 grace_) external {
        _onlyOwner();
        _s().grace = grace_;
        emit GraceSet(grace_);
    }

    /// @notice Pause blocks new advances. Repay, mark-late, and withdraw still run.
    function setPaused(bool paused_) external {
        _onlyOwner();
        _s().paused = paused_;
        emit PausedSet(paused_);
    }

    /// @notice Global fee floor, tenor, concentration, and mandate expiry. Zero expiry blocks every advance.
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

    /// @notice Approve or revoke a platform. Revocation does not unwind an open advance.
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

    /// @notice Recipient that must match the proposal. Address zero means the platform itself.
    function setPayout(address platform, address to) external {
        _onlyOwner();
        _s().payoutTo[platform] = to;
        emit PayoutSet(platform, to);
    }

    /// @notice Queue an implementation. It can be executed after `upgradeDelay`.
    function scheduleUpgrade(address implementation_) external {
        _onlyOwner();
        if (implementation_.code.length == 0) revert BadParam();
        VaultLayout.Layout storage s = _s();
        s.scheduledImpl = implementation_;
        s.scheduledEta = uint64(block.timestamp + s.upgradeDelay);
        emit UpgradeScheduled(implementation_, s.scheduledEta);
    }

    /// @notice Drop a scheduled implementation. A later execute reverts `UpgradeNotScheduled`.
    function cancelUpgrade() external {
        _onlyOwner();
        VaultLayout.Layout storage s = _s();
        s.scheduledImpl = address(0);
        s.scheduledEta = 0;
        emit UpgradeCancelled();
    }

    /// @notice Delay can only increase.
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

    /// @dev The books must already match. A fee-on-transfer or a rebase that moves the vault balance reverts.
    function _pull(address from, uint256 amount) internal {
        IERC20 token = IERC20(_s().asset);
        VaultLayout.Layout storage s = _s();
        uint256 beforeBal = token.balanceOf(address(this));
        if (beforeBal != s.idleCash + s.reserveCash) revert BalanceMismatch();
        token.safeTransferFrom(from, address(this), amount);
        uint256 afterBal = token.balanceOf(address(this));
        if (afterBal < beforeBal || afterBal - beforeBal != amount) revert BalanceMismatch();
    }

    /// @dev Callers reduce idle or reserve by `amount` first, so the tokens are still here. The recipient must
    ///      receive `amount`. A short transfer or a balance that left the books reverts.
    function _push(address to, uint256 amount) internal {
        IERC20 token = IERC20(_s().asset);
        VaultLayout.Layout storage s = _s();
        uint256 bal = token.balanceOf(address(this));
        if (bal != s.idleCash + s.reserveCash + amount) revert BalanceMismatch();
        uint256 beforeTo = token.balanceOf(to);
        token.safeTransfer(to, amount);
        uint256 afterTo = token.balanceOf(to);
        if (afterTo < beforeTo || afterTo - beforeTo != amount) revert BalanceMismatch();
    }
}
