// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {CoreFixture, StubSource} from "./Support.sol";
import {IFundFactory} from "../../src/interfaces/IFundFactory.sol";
import {IIssuerFund} from "../../src/interfaces/IIssuerFund.sol";
import {ILockgateCreditLine} from "../../src/interfaces/ILockgateCreditLine.sol";
import {ILockgateExitPool} from "../../src/interfaces/ILockgateExitPool.sol";
import {IPricingEngine} from "../../src/interfaces/IPricingEngine.sol";
import {QueueKind} from "../../src/interfaces/IQueueAdapter.sol";
import {CreditLineAdmin} from "../../src/core/CreditLineAdmin.sol";
import {FundFactory} from "../../src/core/FundFactory.sol";
import {LockgateExitPool} from "../../src/core/LockgateExitPool.sol";
import {MockUSDG} from "../../src/core/MockUSDG.sol";
import {OpenCreditVault} from "../../src/core/OpenCreditVault.sol";
import {PlatformReserve} from "../../src/core/PlatformReserve.sol";
import {PlatformShare} from "../../src/core/PlatformShare.sol";
import {PlatformStore} from "../../src/core/PlatformStore.sol";
import {PricingEngine} from "../../src/core/PricingEngine.sol";

/// @notice Selectors and quote strings G8 (`engine`) and G10 (`harness`) compare.
contract InterfaceNamesTest is CoreFixture {
    StubSource internal stub;

    function setUp() public {
        _core();
        stub = _stub(1_000_000e6, 750);
        _post(address(stub), 20e6);
    }

    function test_enginePinsAndHarnessRevertNames() public pure {
        assertEq(ILockgateCreditLine.repay.selector, bytes4(keccak256("repay(uint256)")));
        assertEq(ILockgateCreditLine.repay.selector, hex"371fd8e6");
        assertEq(ILockgateCreditLine.markLate.selector, bytes4(keccak256("markLate(uint256)")));
        assertEq(ILockgateCreditLine.markLate.selector, hex"184f24db");
        assertEq(ILockgateCreditLine.registerSource.selector, bytes4(keccak256("registerSource(address,uint256,uint16)")));
        assertEq(ILockgateCreditLine.setRegistrar.selector, bytes4(keccak256("setRegistrar(address,bool)")));
        assertEq(ILockgateCreditLine.quote.selector, bytes4(keccak256("quote(address,uint256)")));
        assertEq(IPricingEngine.feeBps.selector, bytes4(keccak256("feeBps(uint256,uint256,bool,uint16,uint16)")));
        assertEq(
            IFundFactory.createPlatform.selector,
            bytes4(keccak256("createPlatform(uint8,string,uint64,uint256,address,uint256,uint16)"))
        );
        assertEq(IIssuerFund.exitNow.selector, bytes4(keccak256("exitNow(uint256,uint256)")));
        assertEq(IIssuerFund.processWindow.selector, bytes4(keccak256("processWindow()")));
        assertEq(ILockgateExitPool.sellToLockgate.selector, bytes4(keccak256("sellToLockgate(uint256,uint256)")));
        assertEq(ILockgateExitPool.settle.selector, bytes4(keccak256("settle(uint256)")));

        assertEq(PlatformStore.WindowClosed.selector, bytes4(keccak256("WindowClosed()")));
        assertEq(CreditLineAdmin.TooEarly.selector, bytes4(keccak256("TooEarly()")));
        assertEq(LockgateExitPool.Gated.selector, bytes4(keccak256("Gated()")));
        assertEq(LockgateExitPool.NotReady.selector, bytes4(keccak256("NotReady()")));
        assertEq(MockUSDG.FaucetCap.selector, bytes4(keccak256("FaucetCap(uint256)")));
        assertEq(Ownable.OwnableUnauthorizedAccount.selector, bytes4(keccak256("OwnableUnauthorizedAccount(address)")));
        assertEq(Pausable.EnforcedPause.selector, bytes4(keccak256("EnforcedPause()")));

        assertEq(LockgateExitPool.Gated.selector, CreditLineAdmin.Gated.selector);
        assertEq(LockgateExitPool.Gated.selector, PlatformStore.Gated.selector);
        assertEq(LockgateExitPool.NotReady.selector, OpenCreditVault.NotReady.selector);
        assertEq(LockgateExitPool.AlreadySettled.selector, CreditLineAdmin.AlreadySettled.selector);
        assertEq(LockgateExitPool.NotAvailable.selector, bytes4(keccak256("NotAvailable(string)")));
        assertEq(PlatformStore.NotAvailable.selector, LockgateExitPool.NotAvailable.selector);

        assertEq(CreditLineAdmin.FeeAboveMax.selector, bytes4(keccak256("FeeAboveMax()")));
        assertEq(CreditLineAdmin.FeeTooHigh.selector, bytes4(keccak256("FeeTooHigh(uint256,uint256)")));
        assertTrue(CreditLineAdmin.FeeAboveMax.selector != CreditLineAdmin.FeeTooHigh.selector);
        assertEq(CreditLineAdmin.ReserveShort.selector, bytes4(keccak256("ReserveShort()")));
        assertEq(PlatformReserve.ShortReserve.selector, bytes4(keccak256("ShortReserve(uint256,uint256)")));
        assertTrue(CreditLineAdmin.ReserveShort.selector != PlatformReserve.ShortReserve.selector);
    }

    function test_eventTopicsUseCanonicalTypes() public pure {
        assertEq(
            ILockgateCreditLine.AdvanceDrawn.selector,
            keccak256("AdvanceDrawn(uint256,address,address,uint256,uint256,uint64)")
        );
        assertEq(
            ILockgateCreditLine.AdvanceRepaid.selector,
            keccak256("AdvanceRepaid(uint256,address,uint256,uint8)")
        );
        assertEq(
            ILockgateCreditLine.AdvanceMarkedLate.selector,
            keccak256("AdvanceMarkedLate(uint256,address,uint256,uint256)")
        );
        assertEq(ILockgateCreditLine.ReserveFloorSet.selector, keccak256("ReserveFloorSet(address,uint16)"));
        assertEq(ILockgateCreditLine.ReservePosted.selector, keccak256("ReservePosted(address,address,uint256)"));
        assertEq(ILockgateCreditLine.SourceRegistered.selector, keccak256("SourceRegistered(address,uint256,uint16)"));
        assertEq(
            ILockgateCreditLine.SourceUpdated.selector,
            keccak256("SourceUpdated(address,uint256,uint16,uint16)")
        );
        assertEq(ILockgateCreditLine.SourceDeregistered.selector, keccak256("SourceDeregistered(address)"));
        assertEq(ILockgateCreditLine.RegistrarSet.selector, keccak256("RegistrarSet(address,bool)"));
        assertEq(ILockgateCreditLine.CapitalDeposited.selector, keccak256("CapitalDeposited(address,uint256)"));
        assertEq(ILockgateCreditLine.CapitalWithdrawn.selector, keccak256("CapitalWithdrawn(address,uint256)"));
        assertEq(ILockgateCreditLine.GraceSet.selector, keccak256("GraceSet(uint64)"));
        assertEq(ILockgateCreditLine.CapsSet.selector, keccak256("CapsSet(uint16,uint16)"));
        assertEq(PlatformStore.Configured.selector, keccak256("Configured(address,uint256,uint64)"));
        assertEq(PlatformStore.NavUpdated.selector, keccak256("NavUpdated(uint256)"));
        assertEq(PlatformStore.GateSet.selector, keccak256("GateSet(bool)"));
        assertEq(PlatformStore.CashDeposited.selector, keccak256("CashDeposited(address,uint256)"));
        assertEq(PlatformStore.SharesDeposited.selector, keccak256("SharesDeposited(address,uint256,uint256)"));
        assertEq(
            PlatformStore.RedeemRequested.selector,
            keccak256("RedeemRequested(uint256,address,uint256,uint256)")
        );
        assertEq(PlatformStore.RequestCancelled.selector, keccak256("RequestCancelled(uint256)"));
        assertEq(PlatformStore.RequestPaid.selector, keccak256("RequestPaid(uint256,address,uint256)"));
        assertEq(PlatformStore.RequestPartPaid.selector, keccak256("RequestPartPaid(uint256,uint256,uint256)"));
        assertEq(PlatformStore.AdvanceClosed.selector, keccak256("AdvanceClosed(uint256,uint256)"));
        assertEq(LockgateExitPool.GatedSet.selector, keccak256("GatedSet(bool)"));
        assertEq(OpenCreditVault.YieldAccrued.selector, keccak256("YieldAccrued(uint256)"));
        assertEq(
            OpenCreditVault.WithdrawalRequested.selector,
            keccak256("WithdrawalRequested(uint256,address,uint256,uint256,uint64)")
        );
        assertEq(OpenCreditVault.Claimed.selector, keccak256("Claimed(uint256,address,uint256)"));
        assertEq(OpenCreditVault.CooldownSet.selector, keccak256("CooldownSet(uint64)"));
        assertEq(PlatformReserve.Posted.selector, keccak256("Posted(address,address,uint256)"));
        assertEq(PlatformReserve.Withdrawn.selector, keccak256("Withdrawn(address,address,uint256)"));
        assertEq(PlatformReserve.Slashed.selector, keccak256("Slashed(address,address,uint256)"));
        assertEq(PlatformReserve.AdminSet.selector, keccak256("AdminSet(address,address)"));
        assertEq(PlatformReserve.SlasherSet.selector, keccak256("SlasherSet(address,bool)"));
        assertEq(PlatformReserve.CreditLineSet.selector, keccak256("CreditLineSet(address)"));
        assertEq(PlatformReserve.SlashersLockedSet.selector, keccak256("SlashersLockedSet()"));
        assertEq(FundFactory.DemoWindowSet.selector, keccak256("DemoWindowSet(uint64)"));
        assertEq(PlatformShare.AllowlistSet.selector, keccak256("AllowlistSet(address,bool)"));
        assertEq(MockUSDG.MinterSet.selector, keccak256("MinterSet(address,bool)"));
        assertEq(MockUSDG.Faucet.selector, keccak256("Faucet(address,uint256)"));
        assertEq(MockUSDG.Minted.selector, keccak256("Minted(address,uint256)"));
        assertEq(
            FundFactory.PlatformCreated.selector,
            keccak256("PlatformCreated(address,address,uint8,string)")
        );
        assertEq(
            PlatformStore.ExitAdvanced.selector,
            keccak256("ExitAdvanced(uint256,uint256,uint256,uint256)")
        );
        assertEq(
            PlatformStore.WindowProcessed.selector,
            keccak256("WindowProcessed(uint256,uint64,bool)")
        );
        assertEq(
            LockgateExitPool.Sold.selector,
            keccak256("Sold(uint256,address,uint256,uint256,uint256,uint256)")
        );
        assertEq(LockgateExitPool.Settled.selector, keccak256("Settled(uint256,uint256,uint256)"));
        assertEq(OpenCreditVault.Deposited.selector, keccak256("Deposited(address,uint256,uint256)"));
        assertEq(
            PricingEngine.ParamsUpdated.selector,
            keccak256(
                "ParamsUpdated((uint16,uint16,uint16,uint16,uint16,uint16,uint32,uint16,uint64,uint64,uint16,uint16,uint16,uint64,uint64))"
            )
        );
        assertEq(uint256(ILockgateCreditLine.AdvanceStatus.Active), 0);
        assertEq(uint256(ILockgateCreditLine.AdvanceStatus.Repaid), 1);
        assertEq(uint256(ILockgateCreditLine.AdvanceStatus.Late), 2);
        assertEq(uint256(IIssuerFund.RequestStatus.Queued), 0);
        assertEq(uint256(IIssuerFund.RequestStatus.Advanced), 1);
        assertEq(uint256(IIssuerFund.RequestStatus.Paid), 2);
        assertEq(uint256(IIssuerFund.RequestStatus.Cancelled), 3);
        assertEq(uint256(QueueKind.None), 0);
        assertEq(uint256(QueueKind.WeeklyCycle), 1);
        assertEq(uint256(QueueKind.Epoch), 2);
        assertEq(uint256(QueueKind.QuarterlyGated), 3);
    }

    function test_tupleOrderTheHarnessIndexes() public pure {
        ILockgateCreditLine.Advance memory advance = ILockgateCreditLine.Advance({
            source: address(1),
            to: address(2),
            principal: 3,
            fee: 4,
            drawnAt: 5,
            dueAt: 6,
            status: ILockgateCreditLine.AdvanceStatus.Late
        });
        (, address to, uint256 principal, uint256 fee,, uint64 dueAt, uint8 status) =
            abi.decode(abi.encode(advance), (address, address, uint256, uint256, uint64, uint64, uint8));
        assertEq(to, address(2));
        assertEq(principal, 3);
        assertEq(fee, 4);
        assertEq(dueAt, 6);
        assertEq(status, 2);

        IIssuerFund.Request memory request = IIssuerFund.Request({
            owner: address(1),
            shares: 2,
            navValue: 3,
            requestedAt: 4,
            status: IIssuerFund.RequestStatus.Paid,
            advanceId: 5
        });
        (, uint256 shares, uint256 navValue,, uint8 requestStatus, uint256 advanceId) =
            abi.decode(abi.encode(request), (address, uint256, uint256, uint64, uint8, uint256));
        assertEq(shares, 2);
        assertEq(navValue, 3);
        assertEq(requestStatus, 2);
        assertEq(advanceId, 5);

        ILockgateExitPool.Position memory position = ILockgateExitPool.Position({
            seller: address(1),
            shares: 2,
            navValue: 3,
            fee: 4,
            withdrawalId: 5,
            advanceId: 6,
            readyAt: 7,
            settled: true
        });
        (,, uint256 soldNav, uint256 soldFee,, uint256 soldAdvance, uint64 readyAt, bool settled) = abi.decode(
            abi.encode(position),
            (address, uint256, uint256, uint256, uint256, uint256, uint64, bool)
        );
        assertEq(soldNav, 3);
        assertEq(soldFee, 4);
        assertEq(soldAdvance, 6);
        assertEq(readyAt, 7);
        assertTrue(settled);
    }

    function test_quoteTupleAndHarnessReasonStrings() public {
        (uint256 fee, uint16 bps, bool available, string memory reason) = line.quote(address(stub), 100e6);
        assertEq(fee, 990_000);
        assertEq(bps, 99);
        assertTrue(available);
        assertEq(reason, "");
        (uint16 model, bool priced, string memory modelReason) = pricing.feeBps(600, 0, false, 0, 0);
        assertEq(model, 99);
        assertTrue(priced);
        assertEq(modelReason, "");

        stub.setGated(true);
        (,,, reason) = line.quote(address(stub), 100e6);
        assertEq(reason, "gated");
        stub.setGated(false);
        vm.prank(owner);
        line.pause();
        (,,, reason) = line.quote(address(stub), 100e6);
        assertEq(reason, "paused");
    }
}
