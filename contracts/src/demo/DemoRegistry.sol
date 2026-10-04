// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {SignatureChecker} from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";

/// @notice Explicit TEST identity/registrar ledger. No KYC, license or legal-validity claim.
contract DemoRegistry is EIP712 {
    error Denied();
    error Invalid();
    address public immutable admin;
    address public immutable identitySigner;
    address public settlement;
    struct Organization { uint8 kind; bool active; bytes32 terms; }
    struct Binding { bytes32 identity; uint64 validUntil; }
    struct Holding {
        address originator; bytes32 ownerIdentity; uint256 remaining; uint256 locked;
        uint8 routeMask; bool divisible;
    }
    mapping(address => Organization) public organizations;
    mapping(bytes32 => bool) public testIdentities;
    mapping(bytes32 => address) public identityWallet;
    mapping(address => Binding) public bindings;
    mapping(address => mapping(uint256 => bool)) public bindingNonceUsed;
    mapping(bytes32 => Holding) public holdings;
    mapping(address => bool) public approvedVault;
    bytes32 public constant IDENTITY_TYPEHASH = keccak256(
        "Identity(address wallet,bytes32 identity,uint64 validUntil,uint256 nonce)"
    );
    event OrganizationInvited(address indexed organization, uint8 kind, bytes32 terms);
    event OrganizationActivated(address indexed organization, bytes32 terms);
    event IdentityBound(address indexed wallet, bytes32 indexed identity, uint64 validUntil);
    event HoldingRegistered(bytes32 indexed id, address indexed originator, bytes32 indexed identity, uint256 units);
    event HoldingSettled(bytes32 indexed id, uint256 units, uint8 route, address buyer);

    constructor(address admin_, address identitySigner_) EIP712("LockgateTestIdentity", "1") {
        if (block.chainid != 421614 || admin_ == address(0) || identitySigner_ == address(0)) revert Invalid();
        admin = admin_; identitySigner = identitySigner_;
    }
    modifier onlyAdmin() { if (msg.sender != admin) revert Denied(); _; }
    modifier onlySettlement() { if (msg.sender != settlement) revert Denied(); _; }
    function configureSettlement(address target) external onlyAdmin {
        if (settlement != address(0) || target.code.length == 0) revert Invalid();
        settlement = target;
    }
    function approveVault(address vault) external onlyAdmin {
        if (vault.code.length == 0 || approvedVault[vault]) revert Invalid();
        approvedVault[vault] = true;
    }
    function inviteOrganization(address organization, uint8 kind, bytes32 terms) external onlyAdmin {
        if (organization == address(0) || kind < 1 || kind > 2 || terms == 0 || organizations[organization].kind != 0) revert Invalid();
        organizations[organization] = Organization(kind, false, terms);
        emit OrganizationInvited(organization, kind, terms);
    }
    function activateOrganization(bytes32 acceptedTerms) external {
        Organization storage o = organizations[msg.sender];
        if (o.kind == 0 || o.active || o.terms != acceptedTerms) revert Denied();
        o.active = true;
        emit OrganizationActivated(msg.sender, acceptedTerms);
    }
    function isActive(address organization, uint8 kind) external view returns (bool) {
        Organization memory o = organizations[organization];
        return o.active && o.kind == kind;
    }
    function addTestIdentity(bytes32 identity) external onlyAdmin {
        if (identity == 0 || testIdentities[identity]) revert Invalid();
        testIdentities[identity] = true;
    }
    function identityDigest(address wallet, bytes32 identity, uint64 validUntil, uint256 nonce) public view returns (bytes32) {
        return _hashTypedDataV4(keccak256(abi.encode(IDENTITY_TYPEHASH, wallet, identity, validUntil, nonce)));
    }
    function bindIdentity(bytes32 identity, uint64 validUntil, uint256 nonce, bytes calldata signature) external {
        if (!testIdentities[identity] || validUntil <= block.timestamp || bindingNonceUsed[msg.sender][nonce]) revert Invalid();
        address prior = identityWallet[identity];
        if (prior != address(0) && prior != msg.sender) revert Denied();
        if (!SignatureChecker.isValidSignatureNow(identitySigner, identityDigest(msg.sender, identity, validUntil, nonce), signature)) revert Denied();
        bindingNonceUsed[msg.sender][nonce] = true;
        identityWallet[identity] = msg.sender;
        bindings[msg.sender] = Binding(identity, validUntil);
        emit IdentityBound(msg.sender, identity, validUntil);
    }
    function matches(address wallet, bytes32 identity) public view returns (bool) {
        Binding memory b = bindings[wallet];
        return identity != 0 && b.identity == identity && b.validUntil > block.timestamp;
    }
    function registerHolding(bytes32 id, bytes32 identity, uint256 units, uint8 routeMask, bool divisible) external {
        Organization memory o = organizations[msg.sender];
        if (!o.active || o.kind != 1 || id == 0 || holdings[id].originator != address(0)
            || !testIdentities[identity] || units == 0 || routeMask == 0 || routeMask > 3) revert Invalid();
        holdings[id] = Holding(msg.sender, identity, units, 0, routeMask, divisible);
        emit HoldingRegistered(id, msg.sender, identity, units);
    }
    function holding(bytes32 id) external view returns (Holding memory) { return holdings[id]; }
    function lock(bytes32 id, bytes32 identity, uint256 units, uint8 route) external onlySettlement {
        Holding storage h = holdings[id];
        if (h.ownerIdentity != identity || units == 0 || units > h.remaining - h.locked
            || (route != 1 && route != 2) || h.routeMask & route == 0
            || (!h.divisible && units != h.remaining)) revert Invalid();
        h.locked += units;
    }
    function unlock(bytes32 id, uint256 units) external onlySettlement { holdings[id].locked -= units; }
    function consume(bytes32 id, uint256 units, uint8 route, address buyer) external onlySettlement {
        Holding storage h = holdings[id];
        h.locked -= units; h.remaining -= units;
        emit HoldingSettled(id, units, route, buyer);
    }
}
