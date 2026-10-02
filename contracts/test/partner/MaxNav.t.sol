// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {FeeMath} from "../../src/partner/libraries/FeeMath.sol";
import {AdvanceProposal} from "../../src/interfaces/IAdvanceProposal.sol";
import {RejectReason} from "../../src/partner/Types.sol";
import {VaultFixture} from "./VaultFixture.sol";

/// @notice `maxNav` is the largest nav the mandate would fund, and one unit above it is rejected.
contract MaxNavTest is VaultFixture {
    function setUp() public {
        _deploy();
        vm.startPrank(partner);
        vault.setProposer(engine);
        vault.setMandate(100, 30 days, 10_000, uint64(block.timestamp + 365 days));
        vault.setPlatform(platform, true, type(uint128).max, 0, false, 1 days);
        vm.stopPrank();
    }

    function test_idle98At100BpsStopsAt98BecauseConcentrationBinds() public {
        _deposit(98);
        uint64 due = uint64(block.timestamp + 7 days);
        assertEq(vault.maxNav(platform, 100, due), 98);
        assertEq(uint256(vault.preview(_proposal(98, _fee(98, 100), due, 1))), uint256(RejectReason.None));
        assertEq(uint256(vault.preview(_proposal(99, _fee(99, 100), due, 2))), uint256(RejectReason.Concentration));
    }

    function test_openAdvanceLeavesNoLargerNav() public {
        _deposit(1_000_000 * UNIT);
        uint64 due = uint64(block.timestamp + 7 days);
        _execute(_proposal(100_000 * UNIT, _fee(100_000 * UNIT, 100), due, 1));
        _assertMax(due, 100);
    }

    function testFuzz_maxNavFitsAndTheNextUnitDoesNot(uint96 idleRaw, uint16 bpsRaw, uint16 concRaw) public {
        uint256 idle = bound(idleRaw, 1, 1_000_000 * UNIT);
        uint16 bps = uint16(bound(bpsRaw, 0, 9_999));
        uint16 conc = uint16(bound(concRaw, 1, 10_000));
        vm.startPrank(partner);
        vault.setMandate(bps, 30 days, conc, uint64(block.timestamp + 365 days));
        vm.stopPrank();
        _deposit(idle);
        _assertMax(uint64(block.timestamp + 7 days), bps);
    }

    function _assertMax(uint64 due, uint16 bps) internal view {
        uint256 m = vault.maxNav(platform, bps, due);
        if (m > 0) {
            uint256 fee = _fee(m, bps);
            assertLt(fee, m);
            assertEq(uint256(vault.preview(_proposal(m, fee, due, 7))), uint256(RejectReason.None));
        }
        uint256 nextFee = _fee(m + 1, bps);
        if (nextFee < m + 1) {
            assertTrue(uint256(vault.preview(_proposal(m + 1, nextFee, due, 8))) != uint256(RejectReason.None));
        }
    }

    function _fee(uint256 nav, uint16 bps) internal pure returns (uint256) {
        return FeeMath.mulDivHalfUp(nav, bps, 10_000);
    }

    function _proposal(uint256 nav, uint256 fee, uint64 due, uint256 nonce)
        internal
        view
        returns (AdvanceProposal memory p)
    {
        p = AdvanceProposal({
            platform: platform,
            recipient: platform,
            requestId: nonce,
            navValue: nav,
            fee: fee,
            payout: nav - fee,
            feeBps: 0,
            dueAt: due,
            expiresAt: uint64(block.timestamp + 1 hours),
            nonce: nonce,
            quoteId: bytes32(nonce)
        });
    }
}
