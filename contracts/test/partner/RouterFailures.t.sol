// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {AdvanceProposal} from "../../src/interfaces/IAdvanceProposal.sol";
import {IPartnerRouter} from "../../src/partner/interfaces/IPartnerRouter.sol";
import {PartnerRouter} from "../../src/partner/PartnerRouter.sol";
import {PartnerVault} from "../../src/partner/PartnerVault.sol";
import {PartnerVaultAdmin} from "../../src/partner/PartnerVaultAdmin.sol";
import {Advance} from "../../src/partner/Types.sol";
import {MockUSDG} from "./mocks/ReenterUSDG.sol";
import {Test} from "forge-std/Test.sol";

contract RouterFailuresTest is Test {
    uint256 internal constant UNIT = 1e6;
    uint256 internal enginePk = 0xA11CE;

    MockUSDG internal usdg;
    PartnerRouter internal router;
    PartnerVault internal vault;
    address internal partner;
    address internal platform;
    address internal lockgate;

    function setUp() public {
        partner = vm.addr(0xB0B);
        platform = makeAddr("platform");
        lockgate = makeAddr("lockgate");
        usdg = new MockUSDG();
        router = new PartnerRouter(address(this));
        vault = _vault(1_000_000 * UNIT);
    }

    function test_unknownMismatchAndDuplicateNotify() public {
        vm.prank(lockgate);
        vm.expectRevert(PartnerRouter.UnknownVault.selector);
        router.notifyFunded(keccak256("missing"), 1, platform, UNIT, 1);

        uint256 id = _fund(11);
        Advance memory funded = vault.getAdvance(id);
        vm.prank(address(vault));
        vm.expectRevert(PartnerRouter.Mismatch.selector);
        router.notifyFunded(funded.exitRef, id, funded.platform, funded.navValue + 1, funded.fee);
        vm.prank(address(vault));
        vm.expectRevert(PartnerRouter.Duplicate.selector);
        router.notifyFunded(funded.exitRef, id, funded.platform, funded.navValue, funded.fee);
    }

    function test_emptyRepayAndZeroQuote() public {
        uint256 id = _fund(12);
        bytes32 exitRef = keccak256("exit");
        uint256 owed = vault.owedOf(id);
        usdg.mint(platform, owed);
        vm.startPrank(platform);
        usdg.approve(address(router), owed);
        router.relayRepay(exitRef, 0);
        vm.expectRevert(PartnerRouter.Empty.selector);
        router.relayRepay(exitRef, 0);
        vm.stopPrank();
        assertEq(usdg.balanceOf(address(router)), 0);

        IPartnerRouter.ExitRequest memory request = _request(0);
        assertEq(router.quote(request, IPartnerRouter.Strategy.BestFee).length, 0);
        assertEq(router.quote(request, IPartnerRouter.Strategy.ProRata).length, 0);
        assertEq(router.quote(request, IPartnerRouter.Strategy.RoundRobin).length, 0);
    }

    function _vault(uint256 cash) internal returns (PartnerVault v) {
        v = PartnerVault(
            address(
                new ERC1967Proxy(
                    address(new PartnerVault()),
                    abi.encodeCall(PartnerVaultAdmin.initialize, (partner, address(usdg), 1 days, 1 days))
                )
            )
        );
        router.approveVault(address(v), true);
        vm.startPrank(partner);
        v.setProposer(vm.addr(enginePk));
        v.setMandate(100, 30 days, 10_000, uint64(block.timestamp + 365 days));
        v.setPlatform(platform, true, type(uint128).max, 0, false, 1 days);
        v.setRouter(address(router));
        usdg.mint(partner, cash);
        usdg.approve(address(v), type(uint256).max);
        v.deposit(cash);
        router.register(address(v));
        vm.stopPrank();
    }

    function _request(uint256 nav) internal view returns (IPartnerRouter.ExitRequest memory) {
        return IPartnerRouter.ExitRequest({
            platform: platform,
            recipient: platform,
            navValue: nav,
            feeBps: 100,
            dueAt: uint64(block.timestamp + 7 days),
            exitRef: keccak256("exit")
        });
    }

    function _fund(uint256 nonce) internal returns (uint256 id) {
        uint256 nav = 100_000 * UNIT;
        uint256 fee = (nav * 100) / 10_000;
        AdvanceProposal memory p = AdvanceProposal({
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
            quoteId: keccak256("exit")
        });
        (uint8 vv, bytes32 r, bytes32 s) = vm.sign(enginePk, vault.hashTypedProposal(p));
        vm.prank(partner);
        id = vault.execute(p, abi.encodePacked(r, s, vv), "");
    }
}
