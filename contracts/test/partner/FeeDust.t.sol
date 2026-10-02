// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {AdvanceProposal} from "../../src/interfaces/IAdvanceProposal.sol";
import {IPartnerRouter} from "../../src/partner/interfaces/IPartnerRouter.sol";
import {PartnerRouter} from "../../src/partner/PartnerRouter.sol";
import {PartnerVault} from "../../src/partner/PartnerVault.sol";
import {PartnerVaultAdmin} from "../../src/partner/PartnerVaultAdmin.sol";
import {FeeMath} from "../../src/partner/libraries/FeeMath.sol";
import {RouterLogic} from "../../src/partner/libraries/RouterLogic.sol";
import {Advance, AdvanceStatus} from "../../src/partner/Types.sol";
import {VaultFixture} from "./VaultFixture.sol";

/// @notice Many small advances, and a pro-rata split that rounds most caps to zero.
///         Booked fees, payouts, and token balances stay on the same unit.
contract PartnerFeeDustTest is VaultFixture {
    bytes32 internal constant EXIT = keccak256("fee-dust");
    uint256 internal constant COUNT = 40;
    uint256 internal constant CASH = 100_000;

    function setUp() public {
        _deploy();
        _openMandate();
        vm.prank(partner);
        vault.setPlatform(platform, true, 10_000_000 * UNIT, 0, false, 1 days);
        _deposit(CASH);
    }

    function test_manySmallAdvancesLeaveExactlyTheFees() public {
        uint256[] memory ids = new uint256[](COUNT);
        uint256 sumNav;
        uint256 sumFee;
        uint256 sumPay;
        for (uint256 i; i < COUNT; ++i) {
            uint256 nav = 25 * (i + 1) + 7;
            uint256 fee = _fee(nav, 100);
            uint256 pay = nav - fee;
            ids[i] = _execute(_small(nav, fee, i + 1));
            sumNav += nav;
            sumFee += fee;
            sumPay += pay;
            Advance memory a = vault.getAdvance(ids[i]);
            assertEq(a.fee, fee);
            assertEq(a.principal, pay);
            assertEq(a.feeRemaining + a.principalRemaining, nav);
            assertEq(a.owed, nav);
            assertEq(uint256(a.status), uint256(AdvanceStatus.Active));
        }
        assertEq(sumPay + sumFee, sumNav);
        assertEq(vault.idle(), CASH - sumPay);
        assertEq(vault.outstandingPrincipal(), sumPay);
        assertEq(vault.exposureOf(platform), sumNav);
        assertEq(vault.totalAssets(), CASH);
        assertEq(usdg.balanceOf(address(vault)), vault.idle());
        assertEq(usdg.balanceOf(platform), sumPay);

        vm.prank(platform);
        usdg.approve(address(vault), type(uint256).max);
        for (uint256 i; i < COUNT; ++i) {
            uint256 owed = vault.owedOf(ids[i]);
            usdg.mint(platform, owed - (vault.getAdvance(ids[i]).principal));
            vm.prank(platform);
            vault.repay(ids[i]);
            Advance memory a = vault.getAdvance(ids[i]);
            assertEq(a.feeRemaining, 0);
            assertEq(a.principalRemaining, 0);
            assertEq(a.owed, 0);
            assertEq(uint256(a.status), uint256(AdvanceStatus.Repaid));
        }
        assertEq(vault.idle(), CASH + sumFee);
        assertEq(vault.outstandingPrincipal(), 0);
        assertEq(vault.exposureOf(platform), 0);
        assertEq(vault.totalAssets(), CASH + sumFee);
        assertEq(vault.reserveCash(), 0);
        assertEq(usdg.balanceOf(address(vault)), CASH + sumFee);
        assertEq(usdg.balanceOf(platform), 0);

        uint256 endIdle = vault.idle();
        vm.prank(partner);
        vault.withdraw(endIdle, partner);
        assertEq(vault.idle(), 0);
        assertEq(vault.totalShares(), 0);
        assertEq(vault.outstandingPrincipal(), 0);
        assertEq(usdg.balanceOf(address(vault)), 0);
        assertEq(usdg.balanceOf(partner), CASH + sumFee);
        assertEq(usdg.balanceOf(platform), 0);
    }

    function test_proRataHandsDustToCapsTheFloorSkipped() public pure {
        RouterLogic.Candidate[] memory rows = new RouterLogic.Candidate[](22);
        rows[0] = RouterLogic.Candidate(address(uint160(1)), 100, 100, 1);
        for (uint256 i = 1; i <= 20; ++i) {
            rows[i] = RouterLogic.Candidate(address(uint160(i + 1)), 1, 250, 1);
        }
        rows[21] = RouterLogic.Candidate(address(uint160(99)), 1_000, 10_000, 1);
        RouterLogic.Slice[] memory filled = RouterLogic.proRata(rows, 110);
        uint256 sumNav;
        uint256 sumFee;
        uint256 smalls;
        bool sawBig;
        for (uint256 i; i < filled.length; ++i) {
            _exact(filled[i]);
            sumNav += filled[i].navValue;
            sumFee += filled[i].fee;
            if (filled[i].vault == address(uint160(1))) {
                sawBig = true;
                assertEq(filled[i].navValue, 100);
                assertEq(filled[i].fee, 1);
            } else {
                assertEq(filled[i].navValue, 1);
                assertEq(filled[i].fee, 0);
                ++smalls;
            }
            assertTrue(filled[i].vault != address(uint160(99)));
        }
        assertTrue(sawBig);
        assertEq(smalls, 10);
        assertEq(filled.length, 11);
        assertEq(sumNav, 110);
        assertEq(sumFee, 1);
        assertEq(sumNav - sumFee, 109);
    }

    function test_oneUnitQuotesFundAndRepayWithoutDust() public {
        PartnerRouter router = new PartnerRouter(address(this));
        PartnerVault[6] memory tiny;
        for (uint256 i; i < tiny.length; ++i) {
            tiny[i] = _tiny(router);
        }
        uint64 due = uint64(block.timestamp + 7 days);
        IPartnerRouter.ExitRequest memory request = IPartnerRouter.ExitRequest({
            platform: platform,
            recipient: platform,
            navValue: 4,
            feeBps: 30,
            dueAt: due,
            exitRef: EXIT
        });
        IPartnerRouter.Slice[] memory parts = router.quote(request, IPartnerRouter.Strategy.ProRata);
        assertEq(parts.length, 4);
        uint256 sumNav;
        uint256 sumFee;
        for (uint256 i; i < parts.length; ++i) {
            sumNav += parts[i].navValue;
            sumFee += parts[i].fee;
            assertEq(parts[i].navValue, 1);
            assertEq(parts[i].fee, 0);
            assertEq(parts[i].feeBps, 100);
        }
        assertEq(sumNav, 4);
        assertEq(sumFee, 0);

        for (uint256 i; i < parts.length; ++i) {
            _fundQuoted(PartnerVault(parts[i].vault), parts[i], due, i + 1);
        }
        assertEq(usdg.balanceOf(platform), 4);
        assertEq(usdg.balanceOf(address(router)), 0);
        IPartnerRouter.Record[] memory records = router.recordsOf(EXIT);
        assertEq(records.length, 4);
        vm.startPrank(platform);
        usdg.approve(address(router), type(uint256).max);
        for (uint256 i; i < records.length; ++i) {
            router.relayRepay(EXIT, i);
        }
        vm.stopPrank();

        assertEq(usdg.balanceOf(address(router)), 0);
        assertEq(usdg.balanceOf(platform), 0);
        uint256 held;
        for (uint256 i; i < tiny.length; ++i) {
            assertEq(tiny[i].idle(), 1);
            assertEq(tiny[i].outstandingPrincipal(), 0);
            assertEq(tiny[i].exposureOf(platform), 0);
            assertEq(usdg.balanceOf(address(tiny[i])), 1);
            held += usdg.balanceOf(address(tiny[i]));
        }
        assertEq(held, tiny.length);
        assertEq(usdg.balanceOf(partner), 0);
    }

    function _small(uint256 nav, uint256 fee, uint256 nonce) internal view returns (AdvanceProposal memory p) {
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
            quoteId: keccak256(abi.encode("dust", nonce))
        });
    }

    function _fee(uint256 nav, uint16 bps) internal pure returns (uint256 fee) {
        fee = FeeMath.mulDivHalfUp(nav, bps, FeeMath.BPS);
        if (fee >= nav) fee = nav - 1;
    }

    function _exact(RouterLogic.Slice memory s) internal pure {
        assertEq(s.fee, _fee(s.navValue, s.feeBps));
        assertEq(s.fee + (s.navValue - s.fee), s.navValue);
    }

    function _tiny(PartnerRouter router) internal returns (PartnerVault v) {
        PartnerVault impl = new PartnerVault();
        v = PartnerVault(
            address(
                new ERC1967Proxy(
                    address(impl), abi.encodeCall(PartnerVaultAdmin.initialize, (partner, address(usdg), 1 days, 1 days))
                )
            )
        );
        router.approveVault(address(v), true);
        vm.startPrank(partner);
        v.setProposer(engine);
        v.setMandate(100, 30 days, 10_000, uint64(block.timestamp + 365 days));
        v.setPlatform(platform, true, type(uint128).max, 0, false, 1 days);
        v.setRouter(address(router));
        usdg.mint(partner, 1);
        usdg.approve(address(v), type(uint256).max);
        v.deposit(1);
        router.register(address(v));
        vm.stopPrank();
    }

    function _fundQuoted(PartnerVault v, IPartnerRouter.Slice memory slice, uint64 due, uint256 nonce)
        internal
        returns (uint256 id)
    {
        AdvanceProposal memory p = AdvanceProposal({
            platform: platform,
            recipient: platform,
            requestId: nonce,
            navValue: slice.navValue,
            fee: slice.fee,
            payout: slice.navValue - slice.fee,
            feeBps: slice.feeBps,
            dueAt: due,
            expiresAt: uint64(block.timestamp + 1 hours),
            nonce: nonce,
            quoteId: EXIT
        });
        bytes32 digest = v.hashTypedProposal(p);
        (uint8 vv, bytes32 r, bytes32 s) = vm.sign(enginePk, digest);
        vm.prank(partner);
        id = v.execute(p, abi.encodePacked(r, s, vv), "");
    }
}
