// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {Initializable} from "@openzeppelin/contracts/proxy/utils/Initializable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts/proxy/utils/UUPSUpgradeable.sol";
import {PartnerVault} from "../../src/partner/PartnerVault.sol";
import {PartnerVaultAdmin} from "../../src/partner/PartnerVaultAdmin.sol";
import {PartnerVaultV2} from "./PartnerVaultV2.sol";
import {VaultFixture} from "./VaultFixture.sol";

/// @notice PartnerVault is the only proxy in this area. The facility, router, and auto-approve
///         module are deployed directly and have no initializer or upgrade entry.
contract PartnerProxyInitTest is VaultFixture {
    bytes32 internal constant INIT_SLOT = 0xf0c57e16840df040f15088dc2f81fe391c3923bec73e23a9662efc9c229c6a00;

    function setUp() public {
        _deploy();
    }

    function test_secondInitializeRevertsAndAFailedInitDoesNotLock() public {
        PartnerVault impl = new PartnerVault();
        vm.expectRevert(Initializable.InvalidInitialization.selector);
        impl.initialize(partner, address(usdg), 1 days, 1 days);
        assertEq(uint64(uint256(vm.load(address(impl), INIT_SLOT))), type(uint64).max);
        vm.expectRevert(UUPSUpgradeable.UUPSUnauthorizedCallContext.selector);
        impl.upgradeToAndCall(address(impl), "");

        PartnerVault fresh = PartnerVault(address(new ERC1967Proxy(address(impl), "")));
        assertEq(uint256(vm.load(address(fresh), INIT_SLOT)), 0);
        vm.expectRevert(PartnerVaultAdmin.ZeroAddress.selector);
        fresh.initialize(address(0), address(usdg), 1 days, 1 days);
        vm.expectRevert(PartnerVaultAdmin.BadParam.selector);
        fresh.initialize(partner, address(usdg), 1 hours, 1 days);
        fresh.initialize(partner, address(usdg), 1 days, 7 days);
        assertEq(fresh.owner(), partner);
        assertEq(fresh.asset(), address(usdg));
        assertEq(fresh.grace(), 7 days);
        assertEq(uint64(uint256(vm.load(address(fresh), INIT_SLOT))), 1);

        vm.expectRevert(Initializable.InvalidInitialization.selector);
        fresh.initialize(lockgate, address(usdg), 1 days, 1 days);
        vm.expectRevert(Initializable.InvalidInitialization.selector);
        vault.initialize(lockgate, address(usdg), 1 days, 1 days);
        assertEq(fresh.owner(), partner);
        assertEq(vault.owner(), partner);
        assertEq(vault.grace(), 1 days);
    }

    function test_unauthorizedUpgradeKeepsNamespacedStorage() public {
        bytes32 base = _namespace();
        bytes32 implSlot = bytes32(uint256(keccak256("eip1967.proxy.implementation")) - 1);
        assertTrue(base != bytes32(0) && base != INIT_SLOT && base != implSlot);
        assertEq(uint256(vm.load(address(vault), bytes32(0))), 0);
        assertEq(_addr(base, 0), partner);
        assertEq(_addr(base, 2), address(usdg));
        // pegOracle (20) packs with minPriceE8 (8). The next slot is maxOracleAge, grace, upgradeDelay.
        assertEq(vm.load(address(vault), _word(base, 7)), bytes32(0));
        assertEq(
            vm.load(address(vault), _word(base, 8)),
            bytes32(uint256(1 days) << 64 | uint256(1 days) << 128)
        );

        _deposit(1_000 * UNIT);
        assertEq(uint256(vm.load(address(vault), bytes32(0))), 1);
        assertEq(uint256(vm.load(address(vault), _word(base, 11))), 1_000 * UNIT);
        assertEq(uint256(vm.load(address(vault), _word(base, 14))), 1_000 * UNIT);
        address current = _addr(implSlot, 0);
        uint256 idle = vault.idle();

        PartnerVaultV2 next = new PartnerVaultV2();
        vm.expectRevert(UUPSUpgradeable.UUPSUnauthorizedCallContext.selector);
        vault.proxiableUUID();
        assertEq(next.proxiableUUID(), implSlot);

        vm.prank(lockgate);
        vm.expectRevert(PartnerVaultAdmin.Unauthorized.selector);
        vault.upgradeToAndCall(address(next), "");
        vm.prank(lockgate);
        vm.expectRevert(PartnerVaultAdmin.Unauthorized.selector);
        vault.executeUpgrade();
        vm.prank(partner);
        vm.expectRevert(PartnerVaultAdmin.UpgradeNotScheduled.selector);
        vault.upgradeToAndCall(address(next), "");
        vm.prank(partner);
        vm.expectRevert(PartnerVaultAdmin.UpgradeNotScheduled.selector);
        vault.upgradeToAndCall(address(0), "");

        vm.prank(partner);
        vault.scheduleUpgrade(address(next));
        uint64 eta = vault.scheduledEta();
        vm.warp(eta);
        bytes memory reinit = abi.encodeCall(PartnerVaultAdmin.initialize, (lockgate, address(usdg), 1 days, 1 days));
        vm.prank(partner);
        vm.expectRevert(Initializable.InvalidInitialization.selector);
        vault.upgradeToAndCall(address(next), reinit);
        assertEq(vault.vaultVersion(), 1);
        assertEq(vault.owner(), partner);
        assertEq(vault.idle(), idle);
        assertEq(_addr(implSlot, 0), current);

        vm.prank(partner);
        vault.upgradeToAndCall(address(next), "");
        assertEq(vault.vaultVersion(), 2);
        assertEq(vault.owner(), partner);
        assertEq(vault.asset(), address(usdg));
        assertEq(vault.idle(), idle);
        assertEq(vault.totalShares(), 1_000 * UNIT);
        assertEq(_addr(base, 0), partner);
        assertEq(_addr(implSlot, 0), address(next));
        assertEq(uint256(vm.load(address(vault), bytes32(0))), 1);
        assertEq(uint64(uint256(vm.load(address(vault), INIT_SLOT))), 1);
    }

    function _namespace() internal pure returns (bytes32) {
        return keccak256(abi.encode(uint256(keccak256("lockgate.storage.PartnerVault")) - 1))
            & ~bytes32(uint256(0xff));
    }

    function _word(bytes32 base, uint256 offset) internal pure returns (bytes32) {
        return bytes32(uint256(base) + offset);
    }

    function _addr(bytes32 base, uint256 offset) internal view returns (address) {
        return address(uint160(uint256(vm.load(address(vault), offset == 0 ? base : _word(base, offset)))));
    }
}
