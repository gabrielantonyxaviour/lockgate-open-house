// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {CoreFixture} from "./Support.sol";
import {IIssuerFund} from "../../src/interfaces/IIssuerFund.sol";
import {ILockgateCreditLine} from "../../src/interfaces/ILockgateCreditLine.sol";
import {PlatformConfig} from "../../src/core/PlatformConfig.sol";
import {WeeklyCyclePlatform} from "../../src/core/WeeklyCyclePlatform.sol";

/// @notice `processWindow` repays open advances in list order and stops at the first face that does not fit.
contract RepayOrderFuzzTest is CoreFixture {
    struct Book {
        WeeklyCyclePlatform platform;
        uint256[3] requests;
        uint256[3] ids;
        uint256[3] faces;
        uint256[3] fees;
    }

    function setUp() public {
        _core();
    }

    /// @dev Cash 35e6 clears a 30e6 face and leaves 5e6. The 25e6 face blocks the 5e6 face behind it.
    function test_laterSmallerAdvanceDoesNotJumpTheShortfall() public {
        Book memory book = _open(30e6, 25e6, 5e6);
        uint256 stop = _settle(book, 35e6);
        assertEq(stop, 1);
        assertEq(book.platform.cash(), 5e6);
        assertEq(line.remainingOf(book.ids[2]), 5e6);
        assertEq(_status(book.ids[2]), uint256(ILockgateCreditLine.AdvanceStatus.Active));
    }

    function testFuzz_windowRepaysAPrefixAndDoesNotSkip(uint96 a, uint96 b, uint96 c, uint96 cashIn) public {
        a = uint96(bound(a, 1e6, 40e6));
        b = uint96(bound(b, 1e6, 40e6));
        c = uint96(bound(c, 1e6, 40e6));
        uint256 room = bound(uint256(cashIn), 0, uint256(a) + b + c);
        _settle(_open(a, b, c), room);
    }

    /// @dev Leftover cash covers the third face and does not cover the second. The third stays open.
    function testFuzz_aLaterFitDoesNotJumpAShortfall(uint96 a, uint96 b, uint96 c, uint96 extra) public {
        a = uint96(bound(a, 1e6, 40e6));
        b = uint96(bound(b, 2e6, 40e6));
        c = uint96(bound(c, 1e6, uint256(b) - 1));
        extra = uint96(bound(extra, c, uint256(b) - 1));
        Book memory book = _open(a, b, c);
        uint256 stop = _settle(book, uint256(a) + extra);
        assertEq(stop, 1);
        assertEq(book.platform.cash(), extra);
        assertEq(line.remainingOf(book.ids[1]), b);
        assertEq(line.remainingOf(book.ids[2]), c);
    }

    function _open(uint256 a, uint256 b, uint256 c) internal returns (Book memory book) {
        book.faces = [a, b, c];
        uint256 facesSum = a + b + c;
        book.platform = new WeeklyCyclePlatform(
            PlatformConfig({
                token: address(usdg),
                creditLine: address(line),
                reserve: address(reserve),
                issuer: issuer,
                name: "Repay order",
                nav: 1e6,
                interval: 600,
                initialHolder: issuer,
                initialShares: facesSum * 1e12
            })
        );
        vm.prank(owner);
        line.registerSource(address(book.platform), 1_000_000e6, 750);
        _post(address(book.platform), (facesSum * 750 + 9_999) / 10_000);
        uint256[3] memory shares = [a * 1e12, b * 1e12, c * 1e12];
        vm.startPrank(issuer);
        for (uint256 i; i < 3; ++i) {
            (uint256 requestId, uint256 usdgOut) = book.platform.exitNow(shares[i], 0);
            book.requests[i] = requestId;
            book.ids[i] = book.platform.getRequest(requestId).advanceId;
            book.fees[i] = book.faces[i] - usdgOut;
        }
        vm.stopPrank();
        assertEq(book.platform.firstOpen(), book.requests[0]);
        assertEq(book.platform.nextOpen(book.requests[0]), book.requests[1]);
        assertEq(book.platform.nextOpen(book.requests[1]), book.requests[2]);
    }

    function _settle(Book memory book, uint256 room) internal returns (uint256 stop) {
        if (room != 0) {
            _mint(stranger, room);
            vm.startPrank(stranger);
            usdg.approve(address(book.platform), room);
            book.platform.depositCash(room);
            vm.stopPrank();
        }
        (uint256 cashBefore, uint256 owed,,) = book.platform.previewSettlement();
        uint256 facesSum = book.faces[0] + book.faces[1] + book.faces[2];
        assertEq(cashBefore, room);
        assertEq(owed, facesSum);

        uint256 cursor = room;
        uint256 paid;
        uint256 feePaid;
        stop = 3;
        for (uint256 i; i < 3; ++i) {
            if (cursor < book.faces[i]) {
                stop = i;
                break;
            }
            cursor -= book.faces[i];
            paid += book.faces[i];
            feePaid += book.fees[i];
        }

        uint64 window = book.platform.nextWindow();
        uint256 lineBefore = line.capital();
        vm.warp(window);
        book.platform.processWindow();

        assertEq(book.platform.cash(), room - paid);
        assertEq(line.capital(), lineBefore + paid);
        assertEq(line.earnedFees(), feePaid);
        assertEq(line.eligibleOutstanding(), facesSum - paid);
        assertEq(line.lateOutstanding(), 0);
        assertEq(line.exposure(address(book.platform)), facesSum - paid);
        assertEq(line.accountedAssets(), line.accountedEquity());
        assertEq(book.platform.openCount(), 3 - stop);
        if (stop == 3) {
            assertEq(book.platform.currentCycleId(), 2);
            assertEq(book.platform.nextWindow(), window + 600);
            assertEq(book.platform.firstOpen(), 0);
        } else {
            assertEq(book.platform.currentCycleId(), 1);
            assertEq(book.platform.nextWindow(), window);
            assertEq(book.platform.firstOpen(), book.requests[stop]);
            assertGt(book.faces[stop], room - paid);
        }
        for (uint256 i; i < 3; ++i) {
            IIssuerFund.Request memory request = book.platform.getRequest(book.requests[i]);
            assertEq(uint256(request.status), uint256(IIssuerFund.RequestStatus.Advanced));
            if (i < stop) {
                assertEq(line.remainingOf(book.ids[i]), 0);
                assertEq(_status(book.ids[i]), uint256(ILockgateCreditLine.AdvanceStatus.Repaid));
                assertEq(request.shares, 0);
            } else {
                assertEq(line.remainingOf(book.ids[i]), book.faces[i]);
                assertEq(_status(book.ids[i]), uint256(ILockgateCreditLine.AdvanceStatus.Active));
                assertEq(request.shares, book.faces[i] * 1e12);
            }
        }
    }

    function _status(uint256 id) internal view returns (uint256) {
        return uint256(line.getAdvance(id).status);
    }
}
