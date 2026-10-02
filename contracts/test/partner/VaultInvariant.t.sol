// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {AdvanceProposal} from "../../src/interfaces/IAdvanceProposal.sol";
import {Advance, AdvanceStatus} from "../../src/partner/Types.sol";
import {PartnerVault} from "../../src/partner/PartnerVault.sol";
import {PartnerVaultAdmin} from "../../src/partner/PartnerVaultAdmin.sol";
import {MockUSDG} from "./mocks/ReenterUSDG.sol";

contract VaultHandler is Test {
    uint256 internal constant UNIT = 1e6;
    uint256 internal enginePk = 0xA11CE;

    PartnerVault public vault;
    MockUSDG public usdg;
    address public partner;
    address public lockgate;
    address public platform;
    uint256 public nonce = 1;
    bool public mandateBreached;

    constructor() {
        address engine = vm.addr(enginePk);
        partner = vm.addr(0xB0B);
        lockgate = makeAddr("lockgate");
        platform = makeAddr("platform");
        usdg = new MockUSDG();
        PartnerVault impl = new PartnerVault();
        vault = PartnerVault(
            address(
                new ERC1967Proxy(
                    address(impl), abi.encodeCall(PartnerVaultAdmin.initialize, (partner, address(usdg), 1 days, 1 days))
                )
            )
        );
        vm.startPrank(partner);
        vault.setProposer(engine);
        vault.setMandate(100, 30 days, 10_000, uint64(block.timestamp + 1000 days));
        vault.setPlatform(platform, true, type(uint128).max, 0, false, 1 days);
        usdg.mint(partner, 1_000_000 * UNIT);
        usdg.approve(address(vault), type(uint256).max);
        vault.deposit(1_000_000 * UNIT);
        vm.stopPrank();
    }

    function deposit(uint96 assets) external {
        uint256 amt = bound(assets, 1, 10_000 * UNIT);
        usdg.mint(partner, amt);
        vm.prank(partner);
        try vault.deposit(amt) {} catch {}
    }

    function withdraw(uint96 assets) external {
        uint256 idle = vault.idle();
        if (idle == 0) return;
        uint256 amt = bound(assets, 1, idle);
        vm.prank(partner);
        try vault.withdraw(amt, partner) {} catch {}
    }

    function fund(uint96 navRaw) external {
        uint256 idle = vault.idle();
        if (idle < 2 * UNIT) return;
        uint256 nav = bound(navRaw, UNIT, idle);
        uint256 fee = (nav * 100) / 10_000;
        if (fee == 0 || nav - fee > idle) return;
        AdvanceProposal memory p = _proposal(nav, fee);
        vm.prank(partner);
        try vault.execute(p, _sig(p), "") {} catch {}
    }

    function repay(uint256 idRaw) external {
        uint256 n = vault.advanceCount();
        if (n == 0) return;
        uint256 id = bound(idRaw, 1, n);
        uint256 owed = vault.owedOf(id);
        if (owed == 0) return;
        usdg.mint(platform, owed);
        vm.startPrank(platform);
        usdg.approve(address(vault), owed);
        try vault.repay(id) {} catch {}
        vm.stopPrank();
    }

    function markLate(uint256 idRaw) external {
        uint256 n = vault.advanceCount();
        if (n == 0) return;
        uint256 id = bound(idRaw, 1, n);
        if (vault.getAdvance(id).status != AdvanceStatus.Active) return;
        uint256 when = uint256(vault.getAdvance(id).dueAt) + vault.graceOf(id);
        if (block.timestamp < when) vm.warp(when);
        try vault.markLate(id) {} catch {}
    }

    function writeOff(uint256 idRaw) external {
        uint256 n = vault.advanceCount();
        if (n == 0) return;
        uint256 id = bound(idRaw, 1, n);
        vm.prank(partner);
        try vault.writeOff(id) {} catch {}
    }

    function skim(uint96 extra) external {
        uint256 amt = bound(extra, 1, 1_000 * UNIT);
        usdg.mint(address(vault), amt);
        vm.prank(partner);
        try vault.skim() {} catch {}
    }

    function postReserve(uint96 amount) external {
        uint256 amt = bound(amount, 1, 10_000 * UNIT);
        usdg.mint(platform, amt);
        vm.startPrank(platform);
        usdg.approve(address(vault), amt);
        try vault.postReserve(platform, amt) {} catch {}
        vm.stopPrank();
    }

    function withdrawReserve(uint96 amount) external {
        uint256 posted = vault.reserveOf(platform);
        if (posted == 0) return;
        uint256 amt = bound(amount, 1, posted);
        vm.prank(platform);
        try vault.withdrawReserve(platform, amt, platform) {} catch {}
    }

    function tryRejectUnderpriced(uint96 navRaw) external {
        uint256 idle = vault.idle();
        if (idle < 2 * UNIT) return;
        uint256 nav = bound(navRaw, UNIT, idle);
        uint256 floorFee = (nav * 100) / 10_000;
        if (floorFee == 0) return;
        uint256 beforeCount = vault.advanceCount();
        AdvanceProposal memory p = _priced(nav, floorFee - 1);
        vm.prank(partner);
        try vault.execute(p, _sig(p), "") {} catch {}
        if (vault.advanceCount() != beforeCount) mandateBreached = true;
    }

    function tryRejectWhilePaused(uint96 navRaw) external {
        vm.prank(partner);
        vault.setPaused(true);
        uint256 beforeCount = vault.advanceCount();
        uint256 idle = vault.idle();
        if (idle >= 2 * UNIT) {
            uint256 nav = bound(navRaw, UNIT, idle);
            uint256 fee = (nav * 100) / 10_000;
            if (fee > 0 && nav - fee <= idle) {
                AdvanceProposal memory p = _priced(nav, fee);
                vm.prank(partner);
                try vault.execute(p, _sig(p), "") {} catch {}
            }
        }
        if (vault.advanceCount() != beforeCount) mandateBreached = true;
        vm.prank(partner);
        vault.setPaused(false);
    }

    function lockgateTouches(uint96 navRaw) external {
        vm.startPrank(lockgate);
        try vault.deposit(1) {} catch {}
        try vault.withdraw(1, lockgate) {} catch {}
        try vault.setMandate(0, 1, 1, 1) {} catch {}
        try vault.setPaused(true) {} catch {}
        vm.stopPrank();
        uint256 nav = bound(navRaw, UNIT, 10_000 * UNIT);
        uint256 fee = (nav * 100) / 10_000;
        if (fee == 0) return;
        AdvanceProposal memory p = _proposal(nav, fee);
        vm.prank(lockgate);
        try vault.execute(p, _sig(p), "") {} catch {}
    }

    function _priced(uint256 nav, uint256 fee) internal returns (AdvanceProposal memory p) {
        p = _proposal(nav, fee);
    }

    function _proposal(uint256 nav, uint256 fee) internal returns (AdvanceProposal memory p) {
        uint256 id = nonce++;
        p = AdvanceProposal({
            platform: platform,
            recipient: platform,
            requestId: id,
            navValue: nav,
            fee: fee,
            payout: nav - fee,
            feeBps: 100,
            dueAt: uint64(block.timestamp + 7 days),
            expiresAt: uint64(block.timestamp + 1 hours),
            nonce: id,
            quoteId: bytes32(id)
        });
    }

    function _sig(AdvanceProposal memory p) internal view returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(enginePk, vault.hashTypedProposal(p));
        return abi.encodePacked(r, s, v);
    }
}

contract VaultInvariantTest is Test {
    VaultHandler internal handler;

    function setUp() public {
        handler = new VaultHandler();
        targetContract(address(handler));
    }

    function invariant_solvencyAndLockgateHasNoClaim() public view {
        PartnerVault vault = handler.vault();
        MockUSDG usdg = handler.usdg();
        assertEq(usdg.balanceOf(address(vault)), vault.idle() + vault.reserveCash());
        assertEq(vault.totalAssets(), vault.idle() + vault.outstandingPrincipal());
        uint256 principalSum;
        uint256 owedSum;
        uint256 n = vault.advanceCount();
        for (uint256 i = 1; i <= n; ++i) {
            Advance memory a = vault.getAdvance(i);
            assertEq(a.owed, a.feeRemaining + a.principalRemaining);
            assertLe(a.feeRemaining, a.fee);
            assertLe(a.principalRemaining, a.principal);
            if (a.feeRemaining > 0) assertEq(a.principalRemaining, a.principal);
            if (a.status == AdvanceStatus.Repaid || a.status == AdvanceStatus.WrittenOff) assertEq(a.owed, 0);
            principalSum += a.principalRemaining;
            owedSum += a.owed;
        }
        assertEq(principalSum, vault.outstandingPrincipal());
        assertEq(owedSum, vault.exposureOf(handler.platform()));
        assertEq(vault.reserveOf(handler.platform()), vault.reserveCash());
        assertEq(vault.sharesOf(vault.owner()), vault.totalShares());
        assertEq(vault.sharesOf(handler.lockgate()), 0);
        assertTrue(vault.owner() != handler.lockgate());
        assertEq(usdg.balanceOf(handler.lockgate()), 0);
        assertFalse(handler.mandateBreached());
    }
}
