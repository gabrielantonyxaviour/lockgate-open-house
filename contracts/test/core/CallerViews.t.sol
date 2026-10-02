// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {CoreFixture, StubSource} from "./Support.sol";
import {IIssuerFund} from "../../src/interfaces/IIssuerFund.sol";
import {ILockgateCreditLine} from "../../src/interfaces/ILockgateCreditLine.sol";
import {PlatformConfig} from "../../src/core/PlatformConfig.sol";
import {EpochQueuePlatform} from "../../src/core/EpochQueuePlatform.sol";
import {QuarterlyWindowPlatform} from "../../src/core/QuarterlyWindowPlatform.sol";
import {WeeklyCyclePlatform} from "../../src/core/WeeklyCyclePlatform.sol";

/// @notice Views the partner lifecycle, the e2e book check, and the harness already read.
contract CallerViewsTest is CoreFixture {
    function setUp() public {
        _core();
    }

    /// @dev A 100e6 draw. Exposure is the face. Idle cash is equity minus unpaid principal.
    function test_lineViewsMatchTheBookThePartnerAndE2eRead() public {
        StubSource stub = _stub(1_000_000e6, 750);
        _post(address(stub), 20e6);
        vm.prank(address(stub));
        stub.draw(100e6, investor, type(uint256).max);

        ILockgateCreditLine book = line;
        assertEq(book.totalExposure.selector, bytes4(keccak256("totalExposure()")));
        assertEq(book.accountedAssets.selector, bytes4(keccak256("accountedAssets()")));
        assertEq(book.accountedEquity.selector, bytes4(keccak256("accountedEquity()")));
        assertEq(book.totalExposure(), 100e6);
        assertEq(book.totalExposure(), book.eligibleOutstanding() + book.lateOutstanding());
        assertEq(book.lateOutstanding(), 0);
        assertEq(book.accountedAssets(), book.accountedEquity());
        assertEq(book.accountedEquity() - book.outstanding(), book.capital());
    }

    /// @dev Harness reads `requestCount` after a redeem. Partner `checkGate` staticcalls `gated` and `navUpdatedAt`.
    function test_requestCountAndGateProbeMatchTheHarnessAndPartner() public {
        address weekly = address(new WeeklyCyclePlatform(_cfg("Weekly")));
        address epoch = address(new EpochQueuePlatform(_cfg("Epoch")));
        address quarter = address(new QuarterlyWindowPlatform(_cfg("Quarter")));

        vm.prank(issuer);
        IIssuerFund(weekly).requestRedeem(1e18);
        IIssuerFund fund = IIssuerFund(weekly);
        assertEq(fund.requestCount.selector, bytes4(keccak256("requestCount()")));
        assertEq(fund.requestCount(), 1);
        assertEq(fund.getRequest(1).owner, issuer);
        assertEq(uint256(fund.getRequest(1).status), uint256(IIssuerFund.RequestStatus.Queued));

        _probe(weekly, false);
        _probe(epoch, false);
        _probe(quarter, false);
        vm.prank(issuer);
        IIssuerFund(weekly).setGated(true);
        _probe(weekly, true);
    }

    /// @dev Same decode as `PartnerVaultRead._gateReason`: a word other than 0 is closed, and the timestamp must fit `uint64`.
    function _probe(address platform, bool expectGated) internal view {
        (bool okG, bytes memory g) = platform.staticcall(abi.encodeWithSignature("gated()"));
        assertTrue(okG);
        assertGe(g.length, 32);
        assertEq(abi.decode(g, (uint256)), expectGated ? 1 : 0);
        (bool okN, bytes memory n) = platform.staticcall(abi.encodeWithSignature("navUpdatedAt()"));
        assertTrue(okN);
        assertGe(n.length, 32);
        uint256 updated = abi.decode(n, (uint256));
        assertLe(updated, type(uint64).max);
        assertEq(uint64(updated), IIssuerFund(platform).navUpdatedAt());
    }

    function _cfg(string memory name_) internal view returns (PlatformConfig memory) {
        return PlatformConfig({
            token: address(usdg),
            creditLine: address(line),
            reserve: address(reserve),
            issuer: issuer,
            name: name_,
            nav: 1e6,
            interval: 600,
            initialHolder: issuer,
            initialShares: 1e18
        });
    }
}
