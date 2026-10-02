// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IPartnerRouter} from "../../src/partner/interfaces/IPartnerRouter.sol";
import {AdvanceProposal} from "../../src/interfaces/IAdvanceProposal.sol";
import {AutoApproveModule} from "../../src/partner/AutoApproveModule.sol";
import {PartnerRouter} from "../../src/partner/PartnerRouter.sol";
import {PartnerVault} from "../../src/partner/PartnerVault.sol";
import {VaultFixture} from "./VaultFixture.sol";

/// @notice EIP-170 deployed code is at most 24576 bytes. EIP-3860 init code is at most 49152.
///         Call gas is `snapshots/partner.json`. The test total is `snapshots/partner.gas-snapshot`.
contract PartnerGasTest is VaultFixture {
    uint256 internal constant DEPLOYED_MAX = 24_576;
    uint256 internal constant INIT_MAX = 49_152;

    function setUp() public {
        _deploy();
    }

    function test_deployedCodeFitsEip170AndInitFitsEip3860() public {
        PartnerVault impl = new PartnerVault();
        uint256 vaultRuntime = address(impl).code.length;
        uint256 vaultInit = type(PartnerVault).creationCode.length;
        assertLe(vaultRuntime, DEPLOYED_MAX);
        assertLe(vaultInit, INIT_MAX);

        PartnerRouter router = new PartnerRouter();
        uint256 routerRuntime = address(router).code.length;
        uint256 routerInit = type(PartnerRouter).creationCode.length;
        assertLe(routerRuntime, DEPLOYED_MAX);
        assertLe(routerInit, INIT_MAX);

        AutoApproveModule.Bounds memory bounds = AutoApproveModule.Bounds(1, 1, 100, 30 days, true, false, 100);
        AutoApproveModule module = new AutoApproveModule(partner, address(vault), bounds);
        uint256 moduleRuntime = address(module).code.length;
        uint256 moduleInit = type(AutoApproveModule).creationCode.length
            + abi.encode(partner, address(vault), bounds).length;
        assertLe(moduleRuntime, DEPLOYED_MAX);
        assertLe(moduleInit, INIT_MAX);

        emit log_named_uint("PartnerVault runtime", vaultRuntime);
        emit log_named_uint("PartnerVault init", vaultInit);
        emit log_named_uint("PartnerRouter runtime", routerRuntime);
        emit log_named_uint("PartnerRouter init", routerInit);
        emit log_named_uint("AutoApproveModule runtime", moduleRuntime);
        emit log_named_uint("AutoApproveModule init", moduleInit);
    }

    function test_deposit() public {
        _mint(partner, 1_000 * UNIT);
        vm.prank(partner);
        vault.deposit(1_000 * UNIT);
        _shot("deposit");
    }

    function test_withdraw() public {
        _deposit(1_000 * UNIT);
        vm.prank(partner);
        vault.withdraw(100 * UNIT, partner);
        _shot("withdraw");
    }

    function test_postReserve() public {
        _openMandate();
        _mint(platform, 1_000 * UNIT);
        vm.prank(platform);
        vault.postReserve(platform, 1_000 * UNIT);
        _shot("postReserve");
    }

    function test_withdrawReserve() public {
        _openMandate();
        _reserve(1_000 * UNIT);
        vm.prank(platform);
        vault.withdrawReserve(platform, 1_000 * UNIT, platform);
        _shot("withdrawReserve");
    }

    function test_submitProposal() public {
        _openMandate();
        AdvanceProposal memory p = _proposal(10_000 * UNIT, 1);
        vault.submitProposal(p, _engineSig(vault, p));
        _shot("submitProposal");
    }

    function test_execute() public {
        _arm();
        AdvanceProposal memory p = _proposal(10_000 * UNIT, 1);
        bytes memory sig = _engineSig(vault, p);
        vm.prank(partner);
        vault.execute(p, sig, "");
        _shot("execute");
    }

    function test_approve() public {
        _arm();
        AdvanceProposal memory p = _proposal(10_000 * UNIT, 1);
        vault.submitProposal(p, _engineSig(vault, p));
        vm.prank(partner);
        vault.approve(p);
        _shot("approve");
    }

    function test_repay() public {
        _arm();
        uint256 id = _execute(_proposal(10_000 * UNIT, 1));
        uint256 owed = vault.owedOf(id);
        _mint(platform, owed);
        vm.prank(platform);
        vault.repay(id);
        _shot("repay");
    }

    function test_markLate() public {
        _openMandate();
        _deposit(100_000 * UNIT);
        _reserve(1_000 * UNIT);
        AdvanceProposal memory p = _proposal(10_000 * UNIT, 1);
        uint256 id = _execute(p);
        vm.warp(uint256(p.dueAt) + vault.graceOf(id));
        vault.markLate(id);
        _shot("markLate");
    }

    function test_writeOff() public {
        _openMandate();
        _deposit(100_000 * UNIT);
        _reserve(1_000 * UNIT);
        AdvanceProposal memory p = _proposal(10_000 * UNIT, 1);
        uint256 id = _execute(p);
        vm.warp(uint256(p.dueAt) + vault.graceOf(id));
        vault.markLate(id);
        vm.prank(partner);
        vault.writeOff(id);
        _shot("writeOff");
    }

    function test_quote() public {
        _listed();
        routerQuote();
        _shot("quote");
    }

    function test_relayRepay() public {
        PartnerRouter router = _listed();
        AdvanceProposal memory p = _proposal(10_000 * UNIT, 1);
        uint256 id = _execute(p);
        uint256 owed = vault.owedOf(id);
        _mint(platform, owed);
        vm.prank(platform);
        usdg.approve(address(router), owed);
        vm.prank(platform);
        router.relayRepay(p.quoteId, 0);
        _shot("relayRepay");
    }

    function test_moduleExecute() public {
        _arm();
        AutoApproveModule module = new AutoApproveModule(
            partner,
            address(vault),
            AutoApproveModule.Bounds(50_000 * UNIT, 50_000 * UNIT, 100, 30 days, true, false, 100)
        );
        vm.prank(partner);
        vault.setAutoModule(address(module));
        AdvanceProposal memory p = _proposal(10_000 * UNIT, 1);
        module.execute(p, _engineSig(vault, p));
        _shot("moduleExecute");
    }

    function _arm() internal {
        _openMandate();
        _deposit(100_000 * UNIT);
        _reserve(10_000 * UNIT);
    }

    function _listed() internal returns (PartnerRouter router) {
        _arm();
        router = new PartnerRouter();
        vm.startPrank(partner);
        vault.setRouter(address(router));
        router.register(address(vault));
        vm.stopPrank();
    }

    function routerQuote() internal view {
        PartnerRouter router = PartnerRouter(vault.router());
        IPartnerRouter.ExitRequest memory request = IPartnerRouter.ExitRequest({
            platform: platform,
            recipient: platform,
            navValue: 10_000 * UNIT,
            feeBps: 100,
            dueAt: uint64(block.timestamp + 7 days),
            exitRef: keccak256("gas")
        });
        router.quote(request, IPartnerRouter.Strategy.BestFee);
    }

    function _shot(string memory name) internal {
        uint256 used = vm.snapshotGasLastCall("partner", name);
        assertGt(used, 1_000);
    }
}
