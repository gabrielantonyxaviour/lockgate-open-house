// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {AdvanceProposal} from "../../src/interfaces/IAdvanceProposal.sol";
import {IPartnerRouter} from "../../src/partner/interfaces/IPartnerRouter.sol";
import {PartnerRouter} from "../../src/partner/PartnerRouter.sol";
import {PartnerVault} from "../../src/partner/PartnerVault.sol";
import {PartnerVaultAdmin} from "../../src/partner/PartnerVaultAdmin.sol";
import {MockUSDG} from "./mocks/MockUSDG.sol";

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
        router = new PartnerRouter();
        highFee = _vault(100, 5_000_000 * UNIT);
        lowFee = _vault(50, 2_000_000 * UNIT);
        midFee = _vault(80, 1_000_000 * UNIT);
    }

    function test_bestFeeRoundRobinAndProRata() public {
        IPartnerRouter.ExitRequest memory request = _request(100_000 * UNIT);
        IPartnerRouter.Slice[] memory best = router.quote(request, IPartnerRouter.Strategy.BestFee);
        assertEq(best.length, 1);
        assertEq(best[0].vault, address(lowFee));
        assertEq(best[0].feeBps, 50);
        assertEq(best[0].fee, (100_000 * UNIT * 50) / 10_000);
        IPartnerRouter.Slice[] memory robin = router.quote(request, IPartnerRouter.Strategy.RoundRobin);
        assertEq(robin[0].vault, address(highFee));
        _fund(highFee, 100_000 * UNIT, 1);
        robin = router.quote(request, IPartnerRouter.Strategy.RoundRobin);
        assertEq(robin[0].vault, address(lowFee));
        _fund(lowFee, 100_000 * UNIT, 2);
        robin = router.quote(request, IPartnerRouter.Strategy.RoundRobin);
        assertEq(robin[0].vault, address(midFee));

        PartnerVault a = _vault(100, 300_000 * UNIT);
        PartnerVault b = _vault(100, 200_000 * UNIT);
        PartnerVault c = _vault(100, 100_000 * UNIT);
        IPartnerRouter.Slice[] memory parts = router.quote(_request(500_000 * UNIT), IPartnerRouter.Strategy.ProRata);
        assertGe(parts.length, 2);
        uint256 sum;
        for (uint256 i; i < parts.length; ++i) {
            sum += parts[i].navValue;
            assertLe(parts[i].navValue, PartnerVault(parts[i].vault).maxNav(platform, 30, request.dueAt));
        }
        assertEq(sum, 500_000 * UNIT);
        assertTrue(a.idle() > 0 && b.idle() > 0 && c.idle() > 0);
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
