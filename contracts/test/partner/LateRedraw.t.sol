// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AdvanceProposal} from "../../src/interfaces/IAdvanceProposal.sol";
import {AdvanceStatus, RejectReason} from "../../src/partner/Types.sol";
import {VaultFixture} from "./VaultFixture.sol";

/// @notice A late partner advance does not stop the next execute once reserve is refilled.
contract LateRedrawTest is VaultFixture {
    function setUp() public {
        _deploy();
        _openMandate();
        _deposit(1_000_000 * UNIT);
        _reserve(5_000 * UNIT);
    }

    function test_lateAdvanceDoesNotBlockTheNextExecute() public {
        uint256 first = _execute(_proposal(100_000 * UNIT, 1));
        uint64 due = vault.getAdvance(first).dueAt;
        vm.warp(uint256(due) + vault.graceOf(first));
        vault.markLate(first);
        assertEq(uint256(vault.getAdvance(first).status), uint256(AdvanceStatus.Late));
        assertEq(vault.getAdvance(first).owed, 95_000 * UNIT);

        // A later read of block.timestamp in this same call can stay at the pre-warp value.
        AdvanceProposal memory next = this.freshProposal(100_000 * UNIT, 2);
        assertEq(uint256(vault.preview(next)), uint256(RejectReason.Reserve));
        _reserve(20_000 * UNIT);
        assertEq(uint256(vault.preview(next)), uint256(RejectReason.None));
        uint256 second = _execute(next);
        assertEq(uint256(vault.getAdvance(first).status), uint256(AdvanceStatus.Late));
        assertEq(uint256(vault.getAdvance(second).status), uint256(AdvanceStatus.Active));
        assertEq(vault.getAdvance(first).owed, 95_000 * UNIT);
        assertEq(vault.getAdvance(second).owed, 100_000 * UNIT);
        assertEq(vault.idle(), 807_000 * UNIT);
        assertEq(vault.outstandingPrincipal(), 194_000 * UNIT);
        assertEq(vault.exposureOf(platform), 195_000 * UNIT);
        assertEq(vault.reserveCash(), 20_000 * UNIT);
    }

    function freshProposal(uint256 nav, uint256 nonce) external view returns (AdvanceProposal memory) {
        return _proposal(nav, nonce);
    }
}
