// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {CoreFixture, StubSource} from "./Support.sol";
import {CreditLineAdmin} from "../../src/core/CreditLineAdmin.sol";
import {LockgateCreditLine} from "../../src/core/LockgateCreditLine.sol";
import {PlatformReserve} from "../../src/core/PlatformReserve.sol";
import {PlatformStore} from "../../src/core/PlatformStore.sol";
import {UsdgAdapter} from "../../src/core/UsdgAdapter.sol";
import {UsdgTransfers} from "../../src/core/UsdgTransfers.sol";
import {WeeklyCyclePlatform} from "../../src/core/WeeklyCyclePlatform.sol";
import {ILockgateCreditLine} from "../../src/interfaces/ILockgateCreditLine.sol";
import {QueueKind} from "../../src/interfaces/IQueueAdapter.sol";

/// @notice Pays 90% of `transfer`. `transferFrom` is exact, so capital can still be deposited.
contract TaxToken is ERC20 {
    constructor() ERC20("tax", "TAX") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function transfer(address to, uint256 amount) public override returns (bool) {
        _transfer(msg.sender, to, amount - amount / 10);
        return true;
    }
}

/// @notice Regressions for the stage-1 security pass.
contract SecurityTest is CoreFixture {
    function setUp() public {
        _core();
    }

    function test_graceIsFixedAtDraw() public {
        StubSource stub = _stub(1_000_000e6, 0);
        (uint256 id,) = stub.draw(1e6, investor, type(uint256).max);
        assertEq(line.graceOf(id), 1 days);
        vm.prank(owner);
        line.setGrace(0);
        assertEq(line.grace(), 0);
        assertEq(line.graceOf(id), 1 days);
        uint64 due = line.getAdvance(id).dueAt;
        vm.warp(due);
        vm.expectRevert(CreditLineAdmin.TooEarly.selector);
        line.markLate(id);
        vm.warp(uint256(due) + 1 days);
        line.markLate(id);
        assertEq(uint8(line.getAdvance(id).status), uint8(ILockgateCreditLine.AdvanceStatus.Late));

        stub.poke();
        (uint256 later,) = stub.draw(1e6, investor, type(uint256).max);
        assertEq(line.graceOf(later), 0);
        uint64 dueLater = line.getAdvance(later).dueAt;
        vm.warp(dueLater);
        line.markLate(later);
        assertEq(uint8(line.getAdvance(later).status), uint8(ILockgateCreditLine.AdvanceStatus.Late));
    }

    function test_registrarCannotRewriteAnOpenSource() public {
        StubSource stub = _stub(1_000_000e6, 750);
        address registrar = makeAddr("registrar");
        vm.prank(owner);
        line.setRegistrar(registrar, true);
        vm.prank(registrar);
        vm.expectRevert(CreditLineAdmin.AlreadyRegistered.selector);
        line.registerSource(address(stub), 1, 0);
        assertEq(line.limitOf(address(stub)), 1_000_000e6);
        assertEq(line.reserveBpsOf(address(stub)), 750);
        vm.prank(owner);
        line.registerSource(address(stub), 2_000_000e6, 500);
        assertEq(line.reserveBpsOf(address(stub)), 500);
    }

    function test_zeroUtilizationCapRejectsOneUnit() public {
        StubSource stub = _stub(1_000_000e6, 0);
        vm.prank(owner);
        line.setCaps(0, 10_000);
        vm.expectRevert(CreditLineAdmin.UtilizationCap.selector);
        stub.draw(1e6, investor, type(uint256).max);
        assertEq(line.advanceCount(), 0);
    }

    function test_concentrationRoundsUp() public {
        StubSource first = _stub(1_000_000e6, 0);
        StubSource second = _stub(1_000_000e6, 0);
        first.draw(100e6, investor, type(uint256).max);
        vm.prank(owner);
        line.setCaps(10_000, 5_000);
        second.poke();
        vm.expectRevert(CreditLineAdmin.ConcentrationCap.selector);
        second.draw(100e6 + 1, investor, type(uint256).max);
        second.draw(100e6, investor, type(uint256).max);
        assertEq(line.exposure(address(second)), 100e6);
    }

    function test_pushRejectsAShortDelivery() public {
        TaxToken tax = new TaxToken();
        UsdgAdapter taxAdapter = new UsdgAdapter(address(tax), true);
        PlatformReserve taxReserve = new PlatformReserve(owner, address(taxAdapter));
        LockgateCreditLine taxLine =
            new LockgateCreditLine(owner, address(taxAdapter), address(pricing), address(taxReserve));
        tax.mint(owner, 10e6);
        vm.startPrank(owner);
        tax.approve(address(taxLine), 10e6);
        taxLine.depositCapital(10e6);
        vm.expectRevert(abi.encodeWithSelector(UsdgTransfers.FeeOnTransfer.selector, 10e6, 9e6));
        taxLine.withdrawCapital(10e6);
        vm.stopPrank();
        assertEq(tax.balanceOf(address(taxLine)), 10e6);
        assertEq(taxLine.accountedEquity(), 10e6);
    }

    function test_openQueueCapsAndDropsSettledHistory() public {
        vm.prank(issuer);
        WeeklyCyclePlatform platform = WeeklyCyclePlatform(
            factory.createPlatform(QueueKind.WeeklyCycle, "Cap", 600, 1e6, 1_000_000e6, 0)
        );
        uint256 slots = platform.MAX_OPEN();
        _mint(investor, (slots + 2) * 1e6);
        vm.startPrank(investor);
        usdg.approve(address(platform), type(uint256).max);
        platform.deposit((slots + 2) * 1e6);
        for (uint256 i; i < slots; ++i) platform.requestRedeem(1e18);
        vm.expectRevert(PlatformStore.QueueFull.selector);
        platform.requestRedeem(1e18);
        vm.stopPrank();
        assertEq(platform.openCount(), slots);
        vm.warp(platform.nextWindow());
        platform.processWindow();
        assertEq(platform.openCount(), 0);
        assertEq(platform.firstOpen(), 0);
        assertEq(platform.queueLength(), 0);
        vm.prank(investor);
        uint256 id = platform.requestRedeem(1e18);
        assertEq(platform.firstOpen(), id);
        assertEq(platform.headRequestId(), id);
        assertEq(platform.requestCount(), slots + 1);
    }
}
