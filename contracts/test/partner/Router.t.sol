// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {AdvanceProposal} from "../../src/interfaces/IAdvanceProposal.sol";
import {IPartnerRouter} from "../../src/partner/interfaces/IPartnerRouter.sol";
import {PartnerRouter} from "../../src/partner/PartnerRouter.sol";
import {PartnerVault} from "../../src/partner/PartnerVault.sol";
import {PartnerVaultAdmin} from "../../src/partner/PartnerVaultAdmin.sol";
import {MockUSDG} from "./mocks/ReenterUSDG.sol";

contract RouterTest is Test {
    uint256 internal constant UNIT = 1e6;
    uint256 internal enginePk = 0xA11CE;

    MockUSDG internal usdg;
    PartnerRouter internal router;
    address internal partner;
    address internal engine;
    address internal platform;
    address internal lockgate;
    PartnerVault internal lowFee;
    PartnerVault internal midFee;
    PartnerVault internal highFee;

    function setUp() public {
        engine = vm.addr(enginePk);
        partner = vm.addr(0xB0B);
        platform = makeAddr("platform");
        lockgate = makeAddr("lockgate");
        usdg = new MockUSDG();
        router = new PartnerRouter(address(this));
        highFee = _vault(100, 5_000_000 * UNIT);
        lowFee = _vault(50, 2_000_000 * UNIT);
        midFee = _vault(80, 1_000_000 * UNIT);
    }

    function test_bestFeeRoundRobinAndProRata() public {
        IPartnerRouter.ExitRequest memory request = _request(100_000 * UNIT);
        IPartnerRouter.Slice[] memory best = router.quote(request, IPartnerRouter.Strategy.BestFee);
        assertEq(best.length, 1);
        assertEq(best[0].vault, address(lowFee));
        assertEq(best[0].navValue, 100_000 * UNIT);
        assertEq(best[0].feeBps, 50);
        assertEq(best[0].fee, 500 * UNIT);
        _robin(request, highFee, 100, 1_000 * UNIT);
        _fund(highFee, 100_000 * UNIT, 1);
        _robin(request, lowFee, 50, 500 * UNIT);
        _fund(lowFee, 100_000 * UNIT, 2);
        _robin(request, midFee, 80, 800 * UNIT);

        PartnerVault a = _vault(100, 300_000 * UNIT);
        PartnerVault b = _vault(100, 200_000 * UNIT);
        PartnerVault c = _vault(100, 100_000 * UNIT);
        IPartnerRouter.ExitRequest memory wide = _request(500_000 * UNIT);
        IPartnerRouter.Slice[] memory parts = router.quote(wide, IPartnerRouter.Strategy.ProRata);
        assertEq(parts.length, 6);
        _slice(parts[0], highFee, 291_666_666_669, 2_916_666_667, 100, wide.dueAt);
        _slice(parts[1], lowFee, 113_095_238_095, 565_476_190, 50, wide.dueAt);
        _slice(parts[2], midFee, 59_523_809_523, 476_190_476, 80, wide.dueAt);
        _slice(parts[3], a, 17_857_142_857, 178_571_429, 100, wide.dueAt);
        _slice(parts[4], b, 11_904_761_904, 119_047_619, 100, wide.dueAt);
        _slice(parts[5], c, 5_952_380_952, 59_523_810, 100, wide.dueAt);
        assertEq(a.idle(), 300_000 * UNIT);
        assertEq(b.idle(), 200_000 * UNIT);
        assertEq(c.idle(), 100_000 * UNIT);
        assertEq(highFee.idle(), 4_901_000 * UNIT);
        assertEq(lowFee.idle(), 1_900_500 * UNIT);
        assertEq(midFee.idle(), 1_000_000 * UNIT);
    }

    function _robin(IPartnerRouter.ExitRequest memory request, PartnerVault v, uint16 bps, uint256 fee) internal view {
        IPartnerRouter.Slice[] memory robin = router.quote(request, IPartnerRouter.Strategy.RoundRobin);
        assertEq(robin.length, 1);
        assertEq(robin[0].vault, address(v));
        assertEq(robin[0].navValue, request.navValue);
        assertEq(robin[0].feeBps, bps);
        assertEq(robin[0].fee, fee);
    }

    function _slice(
        IPartnerRouter.Slice memory part,
        PartnerVault v,
        uint256 nav,
        uint256 fee,
        uint16 bps,
        uint64 dueAt
    ) internal view {
        assertEq(part.vault, address(v));
        assertEq(part.navValue, nav);
        assertEq(part.fee, fee);
        assertEq(part.feeBps, bps);
        assertLe(nav, v.maxNav(platform, 30, dueAt));
    }

    function test_repayReturnsOnlyToTheFundingVault() public {
        IPartnerRouter.Slice[] memory best = router.quote(_request(100_000 * UNIT), IPartnerRouter.Strategy.BestFee);
        uint256 idleHigh = highFee.idle();
        uint256 idleMid = midFee.idle();
        uint256 id = _fund(lowFee, 100_000 * UNIT, 7);
        IPartnerRouter.Record[] memory records = router.recordsOf(keccak256("exit"));
        assertEq(records.length, 1);
        assertEq(records[0].vault, address(lowFee));
        assertEq(records[0].advanceId, id);
        uint256 owed = lowFee.owedOf(id);
        usdg.mint(platform, owed);
        vm.startPrank(platform);
        usdg.approve(address(router), owed);
        router.relayRepay(keccak256("exit"), 0);
        vm.stopPrank();
        assertEq(usdg.balanceOf(address(router)), 0);
        assertEq(lowFee.owedOf(id), 0);
        assertEq(lowFee.totalAssets(), 2_000_000 * UNIT + best[0].fee);
        assertEq(highFee.idle(), idleHigh);
        assertEq(midFee.idle(), idleMid);
        assertEq(highFee.advanceCount(), 0);
    }

    function test_lockgateCannotRegisterOrDivertTheQuote() public {
        PartnerVault stranger = _vault(100, UNIT);
        vm.prank(partner);
        router.remove(address(stranger));
        vm.prank(lockgate);
        vm.expectRevert(PartnerRouter.NotOwner.selector);
        router.register(address(stranger));
        IPartnerRouter.ExitRequest memory request = _request(100_000 * UNIT);
        request.recipient = lockgate;
        IPartnerRouter.Slice[] memory none = router.quote(request, IPartnerRouter.Strategy.BestFee);
        assertEq(none.length, 0);
        assertEq(usdg.balanceOf(address(router)), 0);
    }

    function _vault(uint16 minFee, uint256 cash) internal returns (PartnerVault v) {
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
        v.setMandate(minFee, 30 days, 10_000, uint64(block.timestamp + 365 days));
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
            feeBps: 30,
            dueAt: uint64(block.timestamp + 7 days),
            exitRef: keccak256("exit")
        });
    }

    function _fund(PartnerVault v, uint256 nav, uint256 nonce) internal returns (uint256 id) {
        uint16 minFee = v.mandate().minFeeBps;
        uint256 fee = (nav * minFee) / 10_000;
        AdvanceProposal memory p = AdvanceProposal({
            platform: platform,
            recipient: platform,
            requestId: nonce,
            navValue: nav,
            fee: fee,
            payout: nav - fee,
            feeBps: minFee,
            dueAt: uint64(block.timestamp + 7 days),
            expiresAt: uint64(block.timestamp + 1 hours),
            nonce: nonce,
            quoteId: keccak256("exit")
        });
        bytes32 digest = v.hashTypedProposal(p);
        (uint8 vv, bytes32 r, bytes32 s) = vm.sign(enginePk, digest);
        vm.prank(partner);
        id = v.execute(p, abi.encodePacked(r, s, vv), "");
    }
}
