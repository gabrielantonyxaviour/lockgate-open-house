// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Vm} from "forge-std/Vm.sol";
import {AdvanceProposal} from "../../src/interfaces/IAdvanceProposal.sol";
import {Advance} from "../../src/partner/Types.sol";
import {AutoApproveModule} from "../../src/partner/AutoApproveModule.sol";
import {PartnerRouter} from "../../src/partner/PartnerRouter.sol";
import {PartnerVaultAdmin} from "../../src/partner/PartnerVaultAdmin.sol";
import {PartnerVaultV2} from "./PartnerVaultV2.sol";
import {VaultFixture} from "./VaultFixture.sol";

contract PartnerEventsTest is VaultFixture {
    function setUp() public {
        _deploy();
        _openMandate();
    }

    function test_cashReserveAndBadWithdrawal() public {
        _mint(partner, 1_000 * UNIT);
        vm.recordLogs();
        vm.prank(partner);
        vault.deposit(1_000 * UNIT);
        _saw(vm.getRecordedLogs(), address(vault), keccak256("Deposited(address,uint256,uint256)"), _one(partner), abi.encode(1_000 * UNIT, 1_000 * UNIT));

        vm.recordLogs();
        vm.prank(partner);
        vault.withdraw(100 * UNIT, partner);
        _saw(vm.getRecordedLogs(), address(vault), keccak256("Withdrawn(address,uint256,uint256)"), _one(partner), abi.encode(100 * UNIT, 100 * UNIT));

        usdg.mint(address(vault), 7);
        vm.recordLogs();
        vm.prank(partner);
        vault.skim();
        _saw(vm.getRecordedLogs(), address(vault), keccak256("Skimmed(uint256)"), _none(), abi.encode(uint256(7)));

        _mint(platform, 1_000 * UNIT);
        vm.recordLogs();
        vm.prank(platform);
        vault.postReserve(platform, 1_000 * UNIT);
        _saw(
            vm.getRecordedLogs(),
            address(vault),
            keccak256("ReservePosted(address,address,uint256)"),
            _two(platform, platform),
            abi.encode(1_000 * UNIT)
        );

        vm.prank(platform);
        vm.expectRevert(PartnerVaultAdmin.BadParam.selector);
        vault.withdrawReserve(platform, 0, platform);
        vm.prank(platform);
        vm.expectRevert(PartnerVaultAdmin.BadParam.selector);
        vault.withdrawReserve(platform, 1, address(0));
        vm.prank(platform);
        vm.expectRevert(PartnerVaultAdmin.BadParam.selector);
        vault.withdrawReserve(platform, 1_000 * UNIT + 1, platform);
        vm.prank(makeAddr("stranger"));
        vm.expectRevert(PartnerVaultAdmin.Unauthorized.selector);
        vault.withdrawReserve(platform, 1, platform);

        vm.recordLogs();
        vm.prank(platform);
        vault.withdrawReserve(platform, 1, platform);
        _saw(vm.getRecordedLogs(), address(vault), keccak256("ReserveWithdrawn(address,address,uint256)"), _two(platform, platform), abi.encode(uint256(1)));
    }

    function test_submitCancelFundAndRelay() public {
        AdvanceProposal memory filed = _proposal(4_000 * UNIT, 7);
        bytes memory filedSig = _engineSig(vault, filed);
        vm.recordLogs();
        vault.submitProposal(filed, filedSig);
        _saw(
            vm.getRecordedLogs(),
            address(vault),
            keccak256("ProposalSubmitted(uint256,bytes32)"),
            _word(7),
            abi.encode(vault.proposalHashOf(7))
        );
        vm.recordLogs();
        vm.prank(partner);
        vault.cancel(7);
        _saw(vm.getRecordedLogs(), address(vault), keccak256("ProposalCancelled(uint256)"), _word(7), "");

        PartnerRouter router = new PartnerRouter(address(this));
        vm.prank(partner);
        vault.setRouter(address(router));
        router.approveVault(address(vault), true);
        vm.prank(partner);
        router.register(address(vault));
        _deposit(50_000 * UNIT);
        _reserve(1_000 * UNIT);
        AdvanceProposal memory p = _proposal(4_000 * UNIT, 1);
        bytes memory sig = _engineSig(vault, p);
        vm.recordLogs();
        vm.prank(partner);
        uint256 id = vault.execute(p, sig, "");
        assertEq(id, 1);
        Vm.Log[] memory funded = vm.getRecordedLogs();
        _saw(
            funded,
            address(router),
            keccak256("ExitFunded(bytes32,address,uint256,uint256,uint256)"),
            _ref(p.quoteId, address(vault), id),
            abi.encode(p.navValue, p.fee)
        );
        _saw(
            funded,
            address(vault),
            keccak256("AdvanceFunded(uint256,address,address,uint256,uint256,bytes32)"),
            _fund(id, platform, platform),
            abi.encode(p.navValue, p.fee, p.quoteId)
        );

        usdg.mint(platform, p.fee);
        vm.prank(platform);
        usdg.approve(address(router), p.navValue);
        vm.recordLogs();
        vm.prank(platform);
        router.relayRepay(p.quoteId, 0);
        Vm.Log[] memory repaid = vm.getRecordedLogs();
        _saw(repaid, address(vault), keccak256("AdvanceRepaid(uint256,address,uint256)"), _pay(id, address(router)), abi.encode(p.navValue));
        _saw(
            repaid,
            address(router),
            keccak256("ExitRepaid(bytes32,address,uint256,uint256)"),
            _two32(p.quoteId, address(vault)),
            abi.encode(id, p.navValue)
        );
    }

    function test_markLateAndWriteOff() public {
        _deposit(50_000 * UNIT);
        _reserve(1_000 * UNIT);
        AdvanceProposal memory p = _proposal(4_000 * UNIT, 1);
        uint256 id = _execute(p);
        Advance memory open = vault.getAdvance(id);
        vm.warp(uint256(open.dueAt) + vault.graceOf(id));
        vm.recordLogs();
        vault.markLate(id);
        _saw(vm.getRecordedLogs(), address(vault), keccak256("AdvanceLate(uint256,uint256,uint256)"), _word(id), abi.encode(1_000 * UNIT, 3_000 * UNIT));
        vm.recordLogs();
        vm.prank(partner);
        vault.writeOff(id);
        _saw(vm.getRecordedLogs(), address(vault), keccak256("AdvanceWrittenOff(uint256,uint256)"), _word(id), abi.encode(3_000 * UNIT));
    }

    function test_upgradeAndModuleEvents() public {
        PartnerVaultV2 next = new PartnerVaultV2();
        vm.recordLogs();
        vm.prank(partner);
        vault.scheduleUpgrade(address(next));
        uint64 eta = vault.scheduledEta();
        _saw(vm.getRecordedLogs(), address(vault), keccak256("UpgradeScheduled(address,uint64)"), _one(address(next)), abi.encode(eta));
        vm.recordLogs();
        vm.prank(partner);
        vault.cancelUpgrade();
        _saw(vm.getRecordedLogs(), address(vault), keccak256("UpgradeCancelled()"), _none(), "");

        vm.prank(partner);
        vault.scheduleUpgrade(address(next));
        vm.warp(vault.scheduledEta());
        vm.recordLogs();
        vm.prank(partner);
        vault.executeUpgrade();
        _saw(vm.getRecordedLogs(), address(vault), keccak256("UpgradeExecuted(address)"), _one(address(next)), "");
        assertEq(PartnerVaultV2(address(vault)).vaultVersion(), 2);

        AutoApproveModule module = new AutoApproveModule(
            partner,
            address(vault),
            AutoApproveModule.Bounds({
                maxNavValue: 1,
                dailyLimit: 1,
                minFeeBps: 100,
                maxTenor: 30 days,
                enabled: true,
                allowlistEnabled: false,
                maxFeeBps: 100
            })
        );
        vm.prank(makeAddr("stranger"));
        vm.expectRevert(AutoApproveModule.Unauthorized.selector);
        module.transferOwnership(makeAddr("next"));
        vm.prank(partner);
        vm.expectRevert(AutoApproveModule.ZeroAddress.selector);
        module.transferOwnership(address(0));
        address pending = makeAddr("pending");
        vm.recordLogs();
        vm.prank(partner);
        module.transferOwnership(pending);
        _saw(vm.getRecordedLogs(), address(module), keccak256("OwnershipTransferStarted(address)"), _one(pending), "");
        vm.recordLogs();
        vm.prank(pending);
        module.acceptOwnership();
        _saw(vm.getRecordedLogs(), address(module), keccak256("OwnershipTransferred(address,address)"), _two(partner, pending), "");
    }

    function _saw(Vm.Log[] memory logs, address emitter, bytes32 sig, bytes32[] memory topics, bytes memory data)
        internal
        pure
    {
        for (uint256 i; i < logs.length; ++i) {
            Vm.Log memory log = logs[i];
            if (log.emitter != emitter || log.topics.length == 0 || log.topics[0] != sig) continue;
            assertEq(log.topics.length, topics.length + 1);
            for (uint256 t; t < topics.length; ++t) assertEq(log.topics[t + 1], topics[t]);
            assertEq(log.data, data);
            return;
        }
        assertTrue(false);
    }

    function _none() internal pure returns (bytes32[] memory t) {
        t = new bytes32[](0);
    }

    function _one(address a) internal pure returns (bytes32[] memory t) {
        t = new bytes32[](1);
        t[0] = bytes32(uint256(uint160(a)));
    }

    function _two(address a, address b) internal pure returns (bytes32[] memory t) {
        t = new bytes32[](2);
        t[0] = bytes32(uint256(uint160(a)));
        t[1] = bytes32(uint256(uint160(b)));
    }

    function _word(uint256 v) internal pure returns (bytes32[] memory t) {
        t = new bytes32[](1);
        t[0] = bytes32(v);
    }

    function _pay(uint256 id, address payer) internal pure returns (bytes32[] memory t) {
        t = new bytes32[](2);
        t[0] = bytes32(id);
        t[1] = bytes32(uint256(uint160(payer)));
    }

    function _two32(bytes32 a, address b) internal pure returns (bytes32[] memory t) {
        t = new bytes32[](2);
        t[0] = a;
        t[1] = bytes32(uint256(uint160(b)));
    }

    function _fund(uint256 id, address a, address b) internal pure returns (bytes32[] memory t) {
        t = new bytes32[](3);
        t[0] = bytes32(id);
        t[1] = bytes32(uint256(uint160(a)));
        t[2] = bytes32(uint256(uint160(b)));
    }

    function _ref(bytes32 exitRef, address vault_, uint256 id) internal pure returns (bytes32[] memory t) {
        t = new bytes32[](3);
        t[0] = exitRef;
        t[1] = bytes32(uint256(uint160(vault_)));
        t[2] = bytes32(id);
    }
}
