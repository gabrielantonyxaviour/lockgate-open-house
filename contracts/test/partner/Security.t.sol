// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AdvanceProposal} from "../../src/interfaces/IAdvanceProposal.sol";
import {IPartnerRouter} from "../../src/partner/interfaces/IPartnerRouter.sol";
import {PartnerRouter} from "../../src/partner/PartnerRouter.sol";
import {PartnerVaultAdmin} from "../../src/partner/PartnerVaultAdmin.sol";
import {AutoApproveModule} from "../../src/partner/AutoApproveModule.sol";
import {AdvanceStatus, RejectReason} from "../../src/partner/Types.sol";
import {VaultFixture} from "./VaultFixture.sol";

contract WideOracle {
    function latest() external pure returns (uint256, uint256) {
        return (1e8, type(uint256).max);
    }
}

contract DirtyGate {
    function gated() external pure returns (uint256) {
        return 2;
    }

    function navUpdatedAt() external pure returns (uint64) {
        return 0;
    }
}

contract RevertVault {
    address public owner;

    constructor(address owner_) {
        owner = owner_;
    }

    function mandate() external pure returns (uint16) {
        revert("no");
    }

    function maxNav(address, uint16, uint64) external pure returns (uint256) {
        revert("no");
    }

    function idle() external pure returns (uint256) {
        revert("no");
    }
}

contract GasVault {
    address public owner;

    constructor(address owner_) {
        owner = owner_;
    }

    function mandate() external pure {
        assembly {
            invalid()
        }
    }
}

contract HugeNav {
    address public owner;

    constructor(address owner_) {
        owner = owner_;
    }

    function mandate() external pure returns (address, address, uint16, uint64, uint16, uint64) {
        return (address(0), address(0), 1, 30 days, 10_000, type(uint64).max);
    }

    function maxNav(address, uint16, uint64) external pure returns (uint256) {
        return type(uint256).max;
    }

    function idle() external pure returns (uint256) {
        return 1_000_000e6;
    }

    function preview(AdvanceProposal calldata) external pure returns (uint8) {
        return 0;
    }
}

contract PartnerSecurityTest is VaultFixture {
    function setUp() public {
        _deploy();
        _openMandate();
        _deposit(1_000_000 * UNIT);
        _reserve(50_000 * UNIT);
    }

    function test_shorteningGraceDoesNotSlashEarly() public {
        AdvanceProposal memory p = _proposal(100_000 * UNIT, 4);
        uint256 id = _execute(p);
        assertEq(vault.graceOf(id), 1 days);
        vm.prank(partner);
        vault.setGrace(0);
        assertEq(vault.grace(), 0);
        assertEq(vault.graceOf(id), 1 days);
        uint256 later = _execute(_proposal(100_000 * UNIT, 40));
        assertEq(vault.graceOf(later), 0);
        vm.warp(p.dueAt);
        vm.expectRevert(PartnerVaultAdmin.TooEarly.selector);
        vault.markLate(id);
        vm.warp(p.dueAt + 1 days);
        vault.markLate(id);
        assertEq(vault.getAdvance(id).owed, 50_000 * UNIT);
        assertEq(uint256(vault.getAdvance(later).status), uint256(AdvanceStatus.Active));
        assertEq(vault.getAdvance(later).owed, 100_000 * UNIT);
        assertEq(vault.reserveCash(), 0);
        assertEq(vault.idle(), 852_000 * UNIT);
        assertEq(vault.outstandingPrincipal(), 149_000 * UNIT);
        assertEq(vault.exposureOf(platform), 150_000 * UNIT);
    }

    function test_wideOracleFailsClosed() public {
        WideOracle oracle = new WideOracle();
        vm.prank(partner);
        vault.setOracle(address(oracle), 1e8, 1 days);
        AdvanceProposal memory p = _proposal(100_000 * UNIT, 5);
        assertEq(uint256(vault.preview(p)), uint256(RejectReason.StaleOracle));
        bytes memory sig = _engineSig(vault, p);
        vm.prank(partner);
        vm.expectRevert(abi.encodeWithSelector(PartnerVaultAdmin.MandateRejected.selector, RejectReason.StaleOracle));
        vault.execute(p, sig, "");
    }

    function test_dirtyGateFailsClosed() public {
        DirtyGate gate = new DirtyGate();
        vm.prank(partner);
        vault.setPlatform(address(gate), true, 10_000_000 * UNIT, 0, true, 1 days);
        AdvanceProposal memory p = _proposal(100_000 * UNIT, 6);
        p.platform = address(gate);
        p.recipient = address(gate);
        assertEq(uint256(vault.preview(p)), uint256(RejectReason.Gated));
        uint256 idleBefore = vault.idle();
        uint256 balBefore = usdg.balanceOf(address(vault));
        bytes memory sig = _engineSig(vault, p);
        vm.prank(partner);
        vm.expectRevert(abi.encodeWithSelector(PartnerVaultAdmin.MandateRejected.selector, RejectReason.Gated));
        vault.execute(p, sig, "");
        assertEq(vault.idle(), idleBefore);
        assertEq(usdg.balanceOf(address(vault)), balBefore);
        assertEq(vault.advanceCount(), 0);
        assertFalse(vault.nonceUsed(p.nonce));
    }

    function test_moduleCapsTheFee() public {
        AutoApproveModule module = new AutoApproveModule(
            partner,
            address(vault),
            AutoApproveModule.Bounds({
                maxNavValue: 200_000 * UNIT,
                dailyLimit: 200_000 * UNIT,
                minFeeBps: 100,
                maxFeeBps: 100,
                maxTenor: 30 days,
                enabled: true,
                allowlistEnabled: false
            })
        );
        vm.prank(partner);
        vault.setAutoModule(address(module));
        AdvanceProposal memory rich = _proposal(100_000 * UNIT, 7);
        rich.feeBps = 500;
        rich.fee = (rich.navValue * 500) / 10_000;
        rich.payout = rich.navValue - rich.fee;
        bytes memory richSig = _engineSig(vault, rich);
        vm.expectRevert(AutoApproveModule.BoundsExceeded.selector);
        module.execute(rich, richSig);
        AdvanceProposal memory almost = _proposal(100_000 * UNIT, 8);
        almost.fee = almost.navValue - 1;
        almost.payout = 1;
        bytes memory almostSig = _engineSig(vault, almost);
        vm.expectRevert(AutoApproveModule.BoundsExceeded.selector);
        module.execute(almost, almostSig);
        AdvanceProposal memory ok = _proposal(100_000 * UNIT, 9);
        module.execute(ok, _engineSig(vault, ok));
        assertEq(vault.advanceCount(), 1);
        assertEq(vault.getAdvance(1).recipient, platform);
        assertEq(vault.getAdvance(1).owed, 100_000 * UNIT);
        assertEq(vault.getAdvance(1).fee, 1_000 * UNIT);
        assertEq(vault.getAdvance(1).feeRemaining, 1_000 * UNIT);
        assertEq(vault.idle(), 901_000 * UNIT);
        assertEq(vault.reserveCash(), 50_000 * UNIT);
        assertEq(usdg.balanceOf(platform), 99_000 * UNIT);
        assertEq(usdg.balanceOf(address(vault)), 951_000 * UNIT);
    }

    function test_oneBadVaultDoesNotBlankTheQuote() public {
        PartnerRouter router = new PartnerRouter(address(this));
        vm.prank(partner);
        vault.setRouter(address(router));
        router.approveVault(address(vault), true);
        vm.prank(partner);
        router.register(address(vault));
        _approveAndList(router, address(new RevertVault(address(this))));
        _approveAndList(router, address(new GasVault(address(this))));
        _approveAndList(router, address(new HugeNav(address(this))));
        IPartnerRouter.ExitRequest memory request = IPartnerRouter.ExitRequest({
            platform: platform,
            recipient: platform,
            navValue: 100_000 * UNIT,
            feeBps: 100,
            dueAt: uint64(block.timestamp + 7 days),
            exitRef: keccak256("security")
        });
        uint256 bal = usdg.balanceOf(address(vault));
        IPartnerRouter.Slice[] memory best = router.quote(request, IPartnerRouter.Strategy.BestFee);
        assertEq(best.length, 1);
        assertEq(best[0].vault, address(vault));
        assertEq(best[0].navValue, 100_000 * UNIT);
        assertEq(best[0].feeBps, 100);
        assertEq(best[0].fee, 1_000 * UNIT);
        IPartnerRouter.Slice[] memory parts = router.quote(request, IPartnerRouter.Strategy.ProRata);
        assertEq(parts.length, 1);
        assertEq(parts[0].vault, address(vault));
        assertEq(parts[0].navValue, 100_000 * UNIT);
        assertEq(parts[0].feeBps, 100);
        assertEq(parts[0].fee, 1_000 * UNIT);
        assertEq(usdg.balanceOf(address(vault)), bal);
        assertEq(vault.advanceCount(), 0);
    }

    function _approveAndList(PartnerRouter r, address v) internal {
        r.approveVault(v, true);
        r.register(v);
    }
}
