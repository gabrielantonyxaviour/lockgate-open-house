// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Vm} from "forge-std/Vm.sol";
import {FacilityStore} from "../../src/facility/FacilityStore.sol";
import {MockBook} from "./mocks/MockBook.sol";
import {FacilityFixture} from "./FacilityFixture.sol";

contract FacilityEventsTest is FacilityFixture {
    function setUp() public {
        _open(10_000, 10_000, 0, 0, 0, address(0), 0, 0);
    }

    function test_depositRedeemDrawRepayAndSweep() public {
        vm.recordLogs();
        vm.prank(governor);
        facility.approveLender(senior, true);
        _saw(vm.getRecordedLogs(), address(facility), keccak256("LenderApproved(address,bool)"), _one(senior), abi.encode(true));

        usdg.mint(senior, 1_000e6);
        vm.startPrank(senior);
        usdg.approve(address(facility), type(uint256).max);
        vm.recordLogs();
        facility.deposit(FacilityStore.Tranche.Senior, 1_000e6);
        vm.stopPrank();
        _saw(
            vm.getRecordedLogs(),
            address(facility),
            keccak256("Deposited(address,uint8,uint256,uint256)"),
            _one(senior),
            abi.encode(FacilityStore.Tranche.Senior, 1_000e6, 1_000e6)
        );

        vm.recordLogs();
        vm.prank(senior);
        facility.redeem(FacilityStore.Tranche.Senior, 400e6);
        _saw(
            vm.getRecordedLogs(),
            address(facility),
            keccak256("Redeemed(address,uint8,uint256,uint256)"),
            _one(senior),
            abi.encode(FacilityStore.Tranche.Senior, 400e6, 400e6)
        );

        vm.recordLogs();
        vm.prank(borrower);
        facility.draw(100e6);
        _saw(vm.getRecordedLogs(), address(facility), keccak256("Drawn(address,uint256)"), _one(borrower), abi.encode(100e6));

        usdg.mint(borrower, 50e6);
        vm.prank(borrower);
        usdg.approve(address(facility), 150e6);
        vm.recordLogs();
        vm.prank(borrower);
        facility.repay(150e6);
        _saw(vm.getRecordedLogs(), address(facility), keccak256("Repaid(address,uint256)"), _one(borrower), abi.encode(150e6));
        assertEq(facility.accounting().residual, 50e6);

        vm.recordLogs();
        vm.prank(governor);
        facility.sweepResidual(governor, 50e6);
        _saw(vm.getRecordedLogs(), address(facility), keccak256("ResidualSwept(address,uint256)"), _one(governor), abi.encode(50e6));
    }

    function test_interestPaid() public {
        _open(10_000, 10_000, 0, 10_000, 0, address(0), 0, 0);
        _deposit(senior, FacilityStore.Tranche.Senior, 1_000e6);
        vm.prank(borrower);
        facility.draw(100e6);
        uint64 started = facility.accounting().lastAccrual;
        vm.warp(uint256(started) + 365 days);
        usdg.mint(borrower, 100e6);
        vm.prank(borrower);
        usdg.approve(address(facility), 200e6);
        vm.prank(borrower);
        facility.repay(200e6);
        vm.recordLogs();
        vm.prank(senior);
        uint256 paid = facility.withdrawInterest(FacilityStore.Tranche.Senior);
        assertEq(paid, 100e6);
        _saw(
            vm.getRecordedLogs(),
            address(facility),
            keccak256("InterestPaid(address,uint8,uint256)"),
            _one(senior),
            abi.encode(FacilityStore.Tranche.Senior, paid)
        );
    }

    function test_termsAndGovernor() public {
        vm.recordLogs();
        vm.prank(governor);
        facility.tightenAdvanceRate(9_000);
        _saw(vm.getRecordedLogs(), address(facility), keccak256("TermsTightened(uint16,uint16,uint16)"), _none(), abi.encode(uint16(9_000), uint16(10_000), uint16(0)));

        uint64 eta = uint64(block.timestamp + 2 days);
        vm.recordLogs();
        vm.prank(governor);
        facility.scheduleTerms(_terms(8_000, 500, 1_000, 800, 1_200));
        _saw(
            vm.getRecordedLogs(),
            address(facility),
            keccak256("TermsScheduled(uint16,uint16,uint16,uint64,uint64,uint64)"),
            _none(),
            abi.encode(uint16(8_000), uint16(500), uint16(1_000), uint64(800), uint64(1_200), eta)
        );
        vm.recordLogs();
        vm.prank(governor);
        facility.cancelTerms();
        _saw(vm.getRecordedLogs(), address(facility), keccak256("TermsCancelled()"), _none(), "");

        vm.prank(governor);
        facility.scheduleTerms(_terms(7_000, 400, 2_000, 700, 900));
        vm.warp(eta);
        vm.recordLogs();
        vm.prank(governor);
        facility.executeTerms();
        _saw(
            vm.getRecordedLogs(),
            address(facility),
            keccak256("TermsExecuted(uint16,uint16,uint16,uint64,uint64)"),
            _none(),
            abi.encode(uint16(7_000), uint16(400), uint16(2_000), uint64(700), uint64(900))
        );

        address next = makeAddr("nextgov");
        vm.recordLogs();
        vm.prank(governor);
        facility.transferGovernor(next);
        Vm.Log[] memory handoff = vm.getRecordedLogs();
        _saw(handoff, address(facility), keccak256("GovernorTransferStarted(address)"), _one(next), "");
        assertEq(_count(handoff, keccak256("GovernorSet(address)")), 0);
        vm.recordLogs();
        vm.prank(next);
        facility.acceptGovernor();
        _saw(vm.getRecordedLogs(), address(facility), keccak256("GovernorSet(address)"), _one(next), "");
    }

    function test_bookOracleRecoveryAndLoss() public {
        uint64 eta = uint64(block.timestamp + 2 days);
        MockBook next = new MockBook();
        vm.recordLogs();
        vm.prank(governor);
        facility.scheduleBook(address(next));
        _saw(vm.getRecordedLogs(), address(facility), keccak256("BookScheduled(address,uint64)"), _one(address(next)), abi.encode(eta));
        address peg = makeAddr("peg");
        vm.recordLogs();
        vm.prank(governor);
        facility.scheduleOracle(peg, 99_000_000, 1 hours);
        _saw(vm.getRecordedLogs(), address(facility), keccak256("OracleScheduled(address,uint64)"), _one(peg), abi.encode(eta));
        vm.warp(eta);
        vm.recordLogs();
        vm.prank(governor);
        facility.executeBook();
        _saw(vm.getRecordedLogs(), address(facility), keccak256("BookSet(address)"), _one(address(next)), "");
        vm.recordLogs();
        vm.prank(governor);
        facility.executeOracle();
        _saw(vm.getRecordedLogs(), address(facility), keccak256("OracleSet(address,uint64,uint64)"), _one(peg), abi.encode(uint64(99_000_000), uint64(1 hours)));

        _open(10_000, 10_000, 0, 0, 0, address(0), 0, 0);
        _deposit(senior, FacilityStore.Tranche.Senior, 500e6);
        _deposit(junior, FacilityStore.Tranche.Junior, 100e6);
        vm.prank(borrower);
        facility.draw(200e6);
        book.set(0, 0);
        vm.recordLogs();
        facility.poke();
        _saw(vm.getRecordedLogs(), address(facility), keccak256("RecoveryEntered(uint256)"), _none(), abi.encode(100e6));
        vm.recordLogs();
        facility.recognizeLoss();
        _saw(vm.getRecordedLogs(), address(facility), keccak256("LossRecognized(uint256)"), _none(), abi.encode(100e6));
    }

    function test_zeroDrawIsBadParam() public {
        vm.prank(borrower);
        vm.expectRevert(FacilityStore.BadParam.selector);
        facility.draw(0);
        vm.prank(senior);
        vm.expectRevert(FacilityStore.Unauthorized.selector);
        facility.draw(1);
    }

    function _terms(uint16 rate, uint16 late, uint16 juniorBps, uint64 seniorApr, uint64 juniorApr)
        internal
        pure
        returns (FacilityStore.PendingTerms memory)
    {
        return FacilityStore.PendingTerms({
            advanceRateBps: rate,
            maxLateBps: late,
            minJuniorBps: juniorBps,
            seniorAprBps: seniorApr,
            juniorAprBps: juniorApr,
            eta: 0,
            active: false
        });
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

    function _count(Vm.Log[] memory logs, bytes32 sig) internal view returns (uint256 n) {
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].emitter == address(facility) && logs[i].topics[0] == sig) n += 1;
        }
    }

    function _none() internal pure returns (bytes32[] memory t) {
        t = new bytes32[](0);
    }

    function _one(address a) internal pure returns (bytes32[] memory t) {
        t = new bytes32[](1);
        t[0] = bytes32(uint256(uint160(a)));
    }
}
