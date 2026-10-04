// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {DemoRegistry} from "./DemoRegistry.sol";
import {UsdgTransfers} from "../core/UsdgTransfers.sol";

/// @notice TEST firm-managed individual book interests, not a transferable/public vault token.
contract DemoFirmVault is ReentrancyGuard {
    error Denied();
    error Invalid();
    address public immutable asset;
    DemoRegistry public immutable registry;
    address public immutable settlement;
    address public immutable manager;
    bytes32 public immutable termsHash;
    uint256 public idleCash;
    uint256 public reservedCash;
    uint256 public outstandingPrincipal;
    uint256 public totalUnits;
    uint256 public fixedClaims;
    mapping(address => uint256) public bookUnits;
    mapping(address => uint256) public queuedUnits;
    mapping(address => uint256) public claimable;
    address[] public providers;
    mapping(address => bool) private knownProvider;
    struct Mandate { uint256 totalLimit; uint256 dealLimit; uint8 routeMask; }
    struct Subscription { address provider; bytes32 identity; uint256 assets; uint64 deadline; bool funded; }
    struct Withdrawal { address owner; uint256 units; }
    struct Loan { address originator; uint256 principal; bool impaired; }
    mapping(address => Mandate) public mandates;
    mapping(address => uint256) public exposure;
    mapping(address => bool) public capConfigured;
    mapping(address => uint16) public capBps;
    mapping(uint256 => Subscription) public subscriptions;
    mapping(uint256 => Withdrawal) public withdrawals;
    mapping(bytes32 => Loan) public loans;
    mapping(bytes32 => mapping(address => uint256)) public recoveryWeight;
    mapping(bytes32 => uint256) public recoveryTotal;
    mapping(bytes32 => uint256) public recoveryExpected;
    mapping(bytes32 => uint256) public recoveryReceived;
    mapping(bytes32 => uint256) public recoveryAllocated;
    uint256 public subscriptionCount;
    uint256 public queueHead = 1;
    uint256 public queueTail;
    event SubscriptionAccepted(uint256 indexed id, address indexed provider, bytes32 identity, uint256 assets, uint64 deadline);
    event Deposited(uint256 indexed id, address indexed provider, uint256 assets, uint256 units, bytes32 terms);
    event WithdrawalRequested(uint256 indexed id, address indexed provider, uint256 units);
    event WithdrawalFilled(uint256 indexed id, uint256 units, uint256 assets);
    event Claimed(address indexed provider, uint256 assets);
    event CapitalReserved(bytes32 indexed deal, address indexed originator, uint256 assets);
    event CapitalPaid(bytes32 indexed deal, address indexed investor, uint256 assets);
    event LoanRepaid(bytes32 indexed deal, uint256 assets, uint256 principalReduced);
    event LoanImpaired(bytes32 indexed deal, uint256 loss);
    event ExposureCapSet(address indexed originator, uint16 bps);

    constructor(address asset_, DemoRegistry registry_, address settlement_, address manager_, bytes32 terms_) {
        if (block.chainid != 421614 || asset_.code.length == 0 || settlement_.code.length == 0
            || !registry_.isActive(manager_, 2) || terms_ == 0 || IERC20Metadata(asset_).decimals() != 6) revert Invalid();
        asset = asset_; registry = registry_; settlement = settlement_; manager = manager_; termsHash = terms_;
    }
    modifier onlyManager() { if (msg.sender != manager) revert Denied(); _; }
    modifier onlySettlement() { if (msg.sender != settlement) revert Denied(); _; }
    function totalAssets() public view returns (uint256) { return idleCash + outstandingPrincipal; }
    function availableCash() public view returns (uint256) { return idleCash - reservedCash; }
    function providerCount() external view returns (uint256) { return providers.length; }
    function setMandate(address originator, uint256 totalLimit, uint256 dealLimit, uint8 routeMask) external onlyManager {
        if (!registry.isActive(originator, 1) || dealLimit > totalLimit || routeMask > 3) revert Invalid();
        mandates[originator] = Mandate(totalLimit, dealLimit, routeMask);
    }
    function setExposureCap(address originator, uint16 bps) external onlyManager {
        if (!registry.isActive(originator, 1) || bps > 10_000) revert Invalid();
        capConfigured[originator] = true; capBps[originator] = bps;
        emit ExposureCapSet(originator, bps);
    }
    function _checkCap(address originator, uint256 resultingExposure) private view {
        if (capConfigured[originator]
            && resultingExposure > Math.mulDiv(totalAssets(), capBps[originator], 10_000)) revert Invalid();
    }
    function acceptSubscription(address provider, bytes32 identity, uint256 assets, uint64 deadline)
        external onlyManager returns (uint256 id)
    {
        if (!registry.matches(provider, identity) || assets == 0 || deadline <= block.timestamp) revert Invalid();
        id = ++subscriptionCount;
        subscriptions[id] = Subscription(provider, identity, assets, deadline, false);
        emit SubscriptionAccepted(id, provider, identity, assets, deadline);
    }
    function deposit(uint256 id, bytes32 acceptedTerms, uint256 minUnits) external nonReentrant returns (uint256 units) {
        Subscription storage s = subscriptions[id];
        if (s.provider != msg.sender || s.funded || s.deadline < block.timestamp || acceptedTerms != termsHash
            || !registry.matches(msg.sender, s.identity)) revert Denied();
        uint256 nav = totalAssets();
        if (totalUnits != 0 && nav == 0) revert Invalid();
        units = totalUnits == 0 ? s.assets : Math.mulDiv(s.assets, totalUnits, nav);
        if (units == 0 || units < minUnits) revert Invalid();
        if (!knownProvider[msg.sender]) {
            if (providers.length >= 10) revert Invalid();
            knownProvider[msg.sender] = true; providers.push(msg.sender);
        }
        s.funded = true; bookUnits[msg.sender] += units; totalUnits += units; idleCash += s.assets;
        UsdgTransfers.pull(asset, msg.sender, address(this), s.assets);
        emit Deposited(id, msg.sender, s.assets, units, acceptedTerms);
    }
    function withdraw(uint256 units) external nonReentrant returns (uint256 assets) {
        if (queueHead <= queueTail || units == 0 || units > bookUnits[msg.sender] - queuedUnits[msg.sender]) revert Invalid();
        assets = Math.mulDiv(units, totalAssets(), totalUnits);
        if (assets > availableCash()) revert Invalid();
        bookUnits[msg.sender] -= units; totalUnits -= units; idleCash -= assets;
        UsdgTransfers.push(asset, msg.sender, assets);
        emit Claimed(msg.sender, assets);
    }
    function requestWithdrawal(uint256 units) external returns (uint256 id) {
        if (units == 0 || units > bookUnits[msg.sender] - queuedUnits[msg.sender]) revert Invalid();
        queuedUnits[msg.sender] += units; id = ++queueTail;
        withdrawals[id] = Withdrawal(msg.sender, units);
        emit WithdrawalRequested(id, msg.sender, units);
    }
    function cancelWithdrawal(uint256 id) external {
        Withdrawal storage w = withdrawals[id];
        if (w.owner != msg.sender || w.units == 0) revert Denied();
        queuedUnits[msg.sender] -= w.units; w.units = 0;
    }
    function processQueue(uint256 maxRequests) external nonReentrant {
        if (maxRequests == 0 || maxRequests > 50) revert Invalid();
        for (uint256 i; i < maxRequests && queueHead <= queueTail; ++i) {
            Withdrawal storage w = withdrawals[queueHead];
            if (w.units == 0) { ++queueHead; continue; }
            uint256 nav = totalAssets();
            if (nav == 0 || availableCash() == 0) break;
            uint256 units = Math.min(w.units, Math.mulDiv(availableCash(), totalUnits, nav));
            uint256 assets = Math.mulDiv(units, nav, totalUnits);
            if (units == 0 || assets == 0) break;
            w.units -= units; queuedUnits[w.owner] -= units; bookUnits[w.owner] -= units;
            totalUnits -= units; idleCash -= assets; fixedClaims += assets; claimable[w.owner] += assets;
            emit WithdrawalFilled(queueHead, units, assets);
            if (w.units != 0) break;
            ++queueHead;
        }
    }
    function claim() external nonReentrant {
        uint256 assets = claimable[msg.sender];
        if (assets == 0) revert Invalid();
        claimable[msg.sender] = 0; fixedClaims -= assets;
        UsdgTransfers.push(asset, msg.sender, assets);
        emit Claimed(msg.sender, assets);
    }
    function reserve(bytes32 deal, address originator, uint256 assets, uint8 route) external onlySettlement {
        Mandate memory m = mandates[originator];
        if (loans[deal].originator != address(0) || assets == 0 || assets > availableCash()
            || assets > m.dealLimit || assets + exposure[originator] > m.totalLimit
            || m.routeMask & route == 0 || queueHead <= queueTail) revert Invalid();
        _checkCap(originator, exposure[originator] + assets);
        reservedCash += assets; exposure[originator] += assets;
        loans[deal] = Loan(originator, assets, false);
        emit CapitalReserved(deal, originator, assets);
    }
    function release(bytes32 deal) external onlySettlement {
        Loan memory l = loans[deal];
        reservedCash -= l.principal; exposure[l.originator] -= l.principal; delete loans[deal];
    }
    function pay(bytes32 deal, address investor, uint8 route) external onlySettlement nonReentrant {
        Loan memory l = loans[deal];
        Mandate memory m = mandates[l.originator];
        uint256 assets = l.principal;
        if (assets > m.dealLimit || exposure[l.originator] > m.totalLimit || m.routeMask & route == 0) revert Invalid();
        _checkCap(l.originator, exposure[l.originator]);
        reservedCash -= assets; idleCash -= assets; outstandingPrincipal += assets;
        UsdgTransfers.push(asset, investor, assets);
        emit CapitalPaid(deal, investor, assets);
    }
    function receiveRepayment(bytes32 deal, address payer, uint256 assets, uint256 principal) external onlySettlement nonReentrant {
        Loan storage l = loans[deal];
        UsdgTransfers.pull(asset, payer, address(this), assets);
        if (l.impaired) { _allocateRecovery(deal, assets); return; }
        if (principal > l.principal || principal > assets) revert Invalid();
        l.principal -= principal; exposure[l.originator] -= principal;
        outstandingPrincipal -= principal; idleCash += assets;
        emit LoanRepaid(deal, assets, principal);
    }
    function impair(bytes32 deal, uint256 remainingDue) external onlySettlement {
        Loan storage l = loans[deal];
        if (l.impaired || l.principal == 0 || totalUnits == 0) revert Invalid();
        l.impaired = true; outstandingPrincipal -= l.principal; exposure[l.originator] -= l.principal;
        recoveryTotal[deal] = totalUnits; recoveryExpected[deal] = remainingDue;
        for (uint256 i; i < providers.length; ++i) recoveryWeight[deal][providers[i]] = bookUnits[providers[i]];
        emit LoanImpaired(deal, l.principal);
        l.principal = 0;
    }
    function _allocateRecovery(bytes32 deal, uint256 assets) private {
        uint256 total = recoveryTotal[deal];
        uint256 prior = recoveryReceived[deal];
        uint256 received = prior + assets;
        recoveryReceived[deal] = received;
        uint256 allocated; address last;
        for (uint256 i; i < providers.length; ++i) {
            address provider = providers[i]; uint256 weight = recoveryWeight[deal][provider];
            if (weight == 0) continue;
            last = provider;
            uint256 part = Math.mulDiv(received, weight, total) - Math.mulDiv(prior, weight, total);
            claimable[provider] += part; allocated += part;
        }
        recoveryAllocated[deal] += allocated;
        if (received == recoveryExpected[deal]) {
            uint256 dust = received - recoveryAllocated[deal];
            claimable[last] += dust; recoveryAllocated[deal] += dust;
        }
        fixedClaims += assets;
        emit LoanRepaid(deal, assets, 0);
    }
}
