// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AdvanceProposal} from "../../src/interfaces/IAdvanceProposal.sol";
import {IPartnerRouter} from "../../src/partner/interfaces/IPartnerRouter.sol";
import {PartnerRouter} from "../../src/partner/PartnerRouter.sol";
import {PartnerVaultAdmin} from "../../src/partner/PartnerVaultAdmin.sol";
import {AutoApproveModule} from "../../src/partner/AutoApproveModule.sol";
import {RejectReason} from "../../src/partner/Types.sol";
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
        vm.prank(partner);
        vault.setGrace(0);
        vm.warp(p.dueAt);
        vm.expectRevert(PartnerVaultAdmin.TooEarly.selector);
        vault.markLate(id);
        vm.warp(p.dueAt + 1 days);
        vault.markLate(id);
        assertGt(vault.getAdvance(id).owed, 0);
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
        assertEq(vault.getAdvance(1).recipient, platform);
    }

    function test_oneBadVaultDoesNotBlankTheQuote() public {
        PartnerRouter router = new PartnerRouter();
        vm.prank(partner);
        vault.setRouter(address(router));
        vm.prank(partner);
        router.register(address(vault));
        router.register(address(new RevertVault(address(this))));
        router.register(address(new GasVault(address(this))));
        router.register(address(new HugeNav(address(this))));
        IPartnerRouter.ExitRequest memory request = IPartnerRouter.ExitRequest({
            platform: platform,
            recipient: platform,
            navValue: 100_000 * UNIT,
            feeBps: 100,
            dueAt: uint64(block.timestamp + 7 days),
            exitRef: keccak256("security")
        });
        IPartnerRouter.Slice[] memory best = router.quote(request, IPartnerRouter.Strategy.BestFee);
        assertEq(best.length, 1);
        assertEq(best[0].vault, address(vault));
        IPartnerRouter.Slice[] memory parts = router.quote(request, IPartnerRouter.Strategy.ProRata);
        assertEq(parts.length, 1);
        assertEq(parts[0].vault, address(vault));
    }
}
