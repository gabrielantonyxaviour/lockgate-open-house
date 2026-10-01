// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {AdvanceProposal} from "../../src/interfaces/IAdvanceProposal.sol";
import {PartnerVault} from "../../src/partner/PartnerVault.sol";
import {PartnerVaultAdmin} from "../../src/partner/PartnerVaultAdmin.sol";
import {MockUSDG} from "./mocks/MockUSDG.sol";

contract VaultFixture is Test {
    uint256 internal constant UNIT = 1e6;

    MockUSDG internal usdg;
    PartnerVault internal vault;
    address internal partner;
    address internal engine;
    address internal lockgate;
    address internal platform;
    uint256 internal enginePk;

    function _deploy() internal {
        enginePk = 0xA11CE;
        engine = vm.addr(enginePk);
        partner = vm.addr(0xB0B);
        lockgate = makeAddr("lockgate");
        platform = makeAddr("platform");
        usdg = new MockUSDG();
        vault = _proxy(partner);
    }

    function _proxy(address owner_) internal returns (PartnerVault v) {
        PartnerVault impl = new PartnerVault();
        bytes memory initData = abi.encodeCall(PartnerVaultAdmin.initialize, (owner_, address(usdg), 1 days, 1 days));
        v = PartnerVault(address(new ERC1967Proxy(address(impl), initData)));
    }

    function _openMandate() internal {
        vm.startPrank(partner);
        vault.setProposer(engine);
        vault.setMandate(100, 30 days, 10_000, uint64(block.timestamp + 365 days));
        vault.setPlatform(platform, true, 10_000_000 * UNIT, 500, false, 1 days);
        vm.stopPrank();
    }

    function _mint(address to, uint256 amount) internal {
        usdg.mint(to, amount);
        vm.prank(to);
        usdg.approve(address(vault), type(uint256).max);
    }

    function _deposit(uint256 amount) internal {
        _mint(partner, amount);
        vm.prank(partner);
        vault.deposit(amount);
    }

    function _reserve(uint256 amount) internal {
        _mint(platform, amount);
        vm.prank(platform);
        vault.postReserve(platform, amount);
    }

    function _proposal(uint256 nav, uint256 nonce) internal view returns (AdvanceProposal memory p) {
        uint256 fee = (nav * 100) / 10_000;
        p = AdvanceProposal({
            platform: platform,
            recipient: platform,
            requestId: nonce,
            navValue: nav,
            fee: fee,
            payout: nav - fee,
            feeBps: 100,
            dueAt: uint64(block.timestamp + 7 days),
            expiresAt: uint64(block.timestamp + 1 hours),
            nonce: nonce,
            quoteId: keccak256(abi.encode("exit", nonce))
        });
    }

    function _engineSig(PartnerVault v, AdvanceProposal memory p) internal view returns (bytes memory) {
        bytes32 digest = v.hashTypedProposal(p);
        (uint8 vv, bytes32 r, bytes32 s) = vm.sign(enginePk, digest);
        return abi.encodePacked(r, s, vv);
    }

    function _execute(AdvanceProposal memory p) internal returns (uint256 id) {
        bytes memory sig = _engineSig(vault, p);
        vm.prank(partner);
        id = vault.execute(p, sig, "");
    }
}
