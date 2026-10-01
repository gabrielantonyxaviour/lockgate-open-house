// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "./IERC20.sol";

/// @title PartnerVault
/// @notice One partner, one vault. The partner is the only owner. Lockgate has no role.
///         Advances move only with the partner's EIP-712 signature and only through `router`.
///         Upgrade intent is timelocked and owner-only. This fixture stores the intent; it is not a proxy.
contract PartnerVault {
    bytes32 public constant TYPEHASH = keccak256(
        "AdvanceProposal(address platform,address recipient,uint256 navValue,uint256 fee,uint64 dueAt,uint256 nonce,uint64 expiry)"
    );
    bytes32 private constant DOMAIN_TYPE = keccak256(
        "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
    );
    uint64 public constant UPGRADE_DELAY = 2 days;

    struct Cap { bool approved; uint256 limit; uint256 exposure; }

    IERC20 public immutable usdg;
    address public router;
    address public owner;
    bool public paused;
    uint16 public minFeeBps;
    uint64 public maxTenor;
    uint16 public maxConcentrationBps;
    uint64 public mandateExpiry;
    uint256 public idle;
    uint256 public outstanding;
    uint256 public nonce;
    address public pendingImpl;
    uint64 public upgradeEta;

    mapping(address => Cap) public caps;

    error NotOwner();
    error NotRouter();
    error PausedAdvance();
    error BadSig();
    error Mandate(string reason);
    error Early();
    error Zero();

    event Ownership(address indexed owner);
    event RouterSet(address indexed router);
    event PausedSet(bool paused);
    event MandateSet(uint16 minFeeBps, uint64 maxTenor, uint16 maxConcentrationBps, uint64 expiry);
    event PlatformSet(address indexed platform, bool approved, uint256 limit);
    event Deposited(address indexed from, uint256 amount);
    event Withdrawn(address indexed to, uint256 amount);
    event AdvanceExecuted(uint256 indexed nonce, address indexed platform, address indexed recipient, uint256 navValue, uint256 fee);
    event Repaid(address indexed platform, uint256 amount);
    event UpgradeProposed(address indexed nextImpl, uint64 eta);
    event UpgradeExecuted(address indexed nextImpl);

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    constructor(address usdg_, address router_, address owner_) {
        if (usdg_ == address(0) || router_ == address(0) || owner_ == address(0)) revert Zero();
        usdg = IERC20(usdg_);
        router = router_;
        owner = owner_;
        emit RouterSet(router_);
        emit Ownership(owner_);
    }

    function setRouter(address next) external onlyOwner {
        if (next == address(0)) revert Zero();
        router = next;
        emit RouterSet(next);
    }

    function setPaused(bool next) external onlyOwner {
        paused = next;
        emit PausedSet(next);
    }

    function setMandate(uint16 minFeeBps_, uint64 maxTenor_, uint16 maxConcentrationBps_, uint64 expiry_) external onlyOwner {
        if (maxConcentrationBps_ > 10_000 || minFeeBps_ > 10_000) revert Mandate("bps");
        minFeeBps = minFeeBps_;
        maxTenor = maxTenor_;
        maxConcentrationBps = maxConcentrationBps_;
        mandateExpiry = expiry_;
        emit MandateSet(minFeeBps_, maxTenor_, maxConcentrationBps_, expiry_);
    }

    function setPlatform(address platform, bool approved, uint256 limit) external onlyOwner {
        if (platform == address(0)) revert Zero();
        Cap storage c = caps[platform];
        c.approved = approved;
        c.limit = limit;
        emit PlatformSet(platform, approved, limit);
    }

    function deposit(uint256 amount) external onlyOwner {
        if (amount == 0) revert Zero();
        usdg.transferFrom(msg.sender, address(this), amount);
        idle += amount;
        emit Deposited(msg.sender, amount);
    }

    function withdraw(uint256 amount) external onlyOwner {
        if (amount == 0 || amount > idle) revert Mandate("cash");
        idle -= amount;
        usdg.transfer(owner, amount);
        emit Withdrawn(owner, amount);
    }

    function proposeUpgrade(address nextImpl) external onlyOwner {
        if (nextImpl == address(0)) revert Zero();
        pendingImpl = nextImpl;
        upgradeEta = uint64(block.timestamp) + UPGRADE_DELAY;
        emit UpgradeProposed(nextImpl, upgradeEta);
    }

    function executeUpgrade() external onlyOwner {
        if (pendingImpl == address(0) || block.timestamp < upgradeEta) revert Early();
        address next = pendingImpl;
        pendingImpl = address(0);
        emit UpgradeExecuted(next);
    }

    function eligible(address platform, uint256 navValue, uint256 fee, uint64 dueAt) external view returns (bool ok, string memory reason) {
        if (paused) return (false, "paused");
        if (block.timestamp > mandateExpiry) return (false, "expired");
        if (dueAt <= block.timestamp || dueAt - block.timestamp > maxTenor) return (false, "tenor");
        Cap storage c = caps[platform];
        if (!c.approved) return (false, "platform");
        if (navValue == 0 || fee >= navValue) return (false, "fee");
        if (fee * 10_000 < uint256(minFeeBps) * navValue) return (false, "min-fee");
        if (c.exposure + navValue > c.limit) return (false, "limit");
        uint256 assets = idle + outstanding;
        if (assets == 0 || (c.exposure + navValue) * 10_000 / assets > maxConcentrationBps) return (false, "concentration");
        if (idle < navValue - fee) return (false, "cash");
        return (true, "");
    }

    function executeAdvance(
        address platform,
        address recipient,
        uint256 navValue,
        uint256 fee,
        uint64 dueAt,
        uint256 nonce_,
        uint64 expiry,
        bytes calldata sig
    ) external returns (uint256 usedNonce) {
        if (msg.sender != router) revert NotRouter();
        if (paused) revert PausedAdvance();
        if (nonce_ != nonce) revert BadSig();
        if (expiry < block.timestamp) revert Mandate("sig-expired");
        (bool ok, string memory why) = this.eligible(platform, navValue, fee, dueAt);
        if (!ok) revert Mandate(why);
        address signer = _recover(_digest(platform, recipient, navValue, fee, dueAt, nonce_, expiry), sig);
        if (signer != owner) revert BadSig();
        usedNonce = nonce;
        nonce = nonce_ + 1;
        uint256 cashOut = navValue - fee;
        idle -= cashOut;
        outstanding += navValue;
        caps[platform].exposure += navValue;
        usdg.transfer(recipient, cashOut);
        emit AdvanceExecuted(usedNonce, platform, recipient, navValue, fee);
    }

    /// @notice Router has already transferred `amount` of USDG into this vault.
    function noteRepay(uint256 amount, address platform) external {
        if (msg.sender != router) revert NotRouter();
        if (amount == 0 || caps[platform].exposure < amount || outstanding < amount) revert Mandate("repay");
        caps[platform].exposure -= amount;
        outstanding -= amount;
        idle += amount;
        emit Repaid(platform, amount);
    }

    function domainSeparator() public view returns (bytes32) {
        return keccak256(abi.encode(
            DOMAIN_TYPE,
            keccak256(bytes("LockgateAdvance")),
            keccak256(bytes("1")),
            block.chainid,
            address(this)
        ));
    }

    function _digest(address platform, address recipient, uint256 navValue, uint256 fee, uint64 dueAt, uint256 nonce_, uint64 expiry)
        internal
        view
        returns (bytes32)
    {
        bytes32 structHash = keccak256(abi.encode(TYPEHASH, platform, recipient, navValue, fee, dueAt, nonce_, expiry));
        return keccak256(abi.encodePacked("\x19\x01", domainSeparator(), structHash));
    }

    function _recover(bytes32 digest, bytes calldata sig) internal pure returns (address) {
        if (sig.length != 65) revert BadSig();
        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly {
            r := calldataload(sig.offset)
            s := calldataload(add(sig.offset, 32))
            v := byte(0, calldataload(add(sig.offset, 64)))
        }
        if (v < 27) v += 27;
        if (v != 27 && v != 28) revert BadSig();
        address signer = ecrecover(digest, v, r, s);
        if (signer == address(0)) revert BadSig();
        return signer;
    }
}
