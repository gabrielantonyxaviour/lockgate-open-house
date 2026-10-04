// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {DemoRegistry} from "../../src/demo/DemoRegistry.sol";
import {DemoFirmVault} from "../../src/demo/DemoFirmVault.sol";
import {DemoSettlement} from "../../src/demo/DemoSettlement.sol";
import {DemoQuote} from "../../src/demo/DemoTypes.sol";

contract DemoAsset is ERC20 {
    constructor() ERC20("Local TEST USDG", "USDG") {}
    function decimals() public pure override returns (uint8) { return 6; }
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}
abstract contract DemoFixture is Test {
    DemoAsset internal token;
    DemoRegistry internal registry;
    DemoSettlement internal settlement;
    DemoFirmVault internal vault;
    uint256 internal constant REVIEWER_KEY = 101;
    uint256 internal constant ORIGINATOR_KEY = 102;
    uint256 internal constant INVESTOR_KEY = 103;
    address internal originator;
    address internal manager = address(0xF1);
    address internal investor;
    address internal provider = address(0xA1);
    address internal provider2 = address(0xA2);
    bytes32 internal constant IDENTITY = keccak256("alex-morgan");
    bytes32 internal constant OTHER_IDENTITY = keccak256("nisha-rao");
    bytes32 internal constant PROVIDER_ID = keccak256("priya-menon");
    bytes32 internal constant PROVIDER2_ID = keccak256("lucas-chen");
    bytes32 internal constant TERMS = keccak256("TEST-only firm terms v1");
    bytes32 internal constant HOLDING = keccak256("originator-test-holding-1");
    function setUp() public virtual {
        vm.chainId(421614); vm.warp(1_800_000_000);
        token = new DemoAsset(); originator = vm.addr(ORIGINATOR_KEY); investor = vm.addr(INVESTOR_KEY);
        registry = new DemoRegistry(address(this), vm.addr(REVIEWER_KEY));
        settlement = new DemoSettlement(registry); registry.configureSettlement(address(settlement));
        _org(originator, 1); _org(manager, 2);
        vault = new DemoFirmVault(address(token), registry, address(settlement), manager, TERMS);
        registry.approveVault(address(vault));
        registry.addTestIdentity(IDENTITY); registry.addTestIdentity(OTHER_IDENTITY);
        registry.addTestIdentity(PROVIDER_ID); registry.addTestIdentity(PROVIDER2_ID);
        _bind(investor, IDENTITY, 1); _bind(provider, PROVIDER_ID, 1); _bind(provider2, PROVIDER2_ID, 1);
        vm.prank(originator); registry.registerHolding(HOLDING, IDENTITY, 1_000e6, 3, true);
        vm.prank(manager); vault.setMandate(originator, 1_000e6, 500e6, 3);
        token.mint(provider, 1_000e6); token.mint(provider2, 1_000e6); token.mint(originator, 1_000e6);
        vm.prank(provider); token.approve(address(vault), type(uint256).max);
        vm.prank(provider2); token.approve(address(vault), type(uint256).max);
        vm.prank(originator); token.approve(address(vault), type(uint256).max);
        _deposit(provider, PROVIDER_ID, 500e6);
    }
    function _org(address who, uint8 kind) internal {
        registry.inviteOrganization(who, kind, TERMS); vm.prank(who); registry.activateOrganization(TERMS);
    }
    function _sig(uint256 key, bytes32 digest) internal pure returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, digest); return abi.encodePacked(r, s, v);
    }
    function _bind(address wallet, bytes32 identity, uint256 nonce) internal {
        uint64 expiry = uint64(block.timestamp + 365 days);
        bytes memory sig = _sig(REVIEWER_KEY, registry.identityDigest(wallet, identity, expiry, nonce));
        vm.prank(wallet); registry.bindIdentity(identity, expiry, nonce, sig);
    }
    function _deposit(address who, bytes32 identity, uint256 amount) internal {
        vm.prank(manager); uint256 id = vault.acceptSubscription(who, identity, amount, uint64(block.timestamp + 1 days));
        vm.prank(who); vault.deposit(id, TERMS, 1);
    }
    function _quote(uint256 nonce, uint8 route) internal view returns (DemoQuote memory q) {
        q = DemoQuote(HOLDING, address(vault), investor, IDENTITY, 100e6, 98e6, 99_500_000,
            route, uint64(block.timestamp + 1 hours), uint64(block.timestamp + 30 days), nonce, keccak256("TEST-exit-v1"));
    }
    function _reserve(DemoQuote memory q) internal returns (bytes32 digest) {
        digest = settlement.quoteDigest(q);
        bytes memory signature = _sig(ORIGINATOR_KEY, digest);
        vm.prank(manager); settlement.reserve(q, signature);
    }
    function _settle(DemoQuote memory q) internal returns (bytes32 digest) {
        digest = _reserve(q); settlement.settle(q, _sig(INVESTOR_KEY, digest));
    }
}
