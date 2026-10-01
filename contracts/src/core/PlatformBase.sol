// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {QueueKind} from "../interfaces/IQueueAdapter.sol";
import {PlatformConfig} from "./PlatformConfig.sol";
import {PlatformStore} from "./PlatformStore.sol";
import {UsdgTransfers} from "./UsdgTransfers.sol";

/// @title PlatformBase
/// @notice Shared sandbox fund. Settlement pays Lockgate in full before any investor. The window does not roll
///         while an advance is still unpaid, so a later cash deposit can finish the same cycle.
contract PlatformBase is PlatformStore {
    constructor(PlatformConfig memory cfg) PlatformStore(cfg) {}

    function setNav(uint256 newNav) external onlyIssuer {
        if (newNav == 0) revert ZeroAmount();
        nav = newNav;
        navUpdatedAt = uint64(block.timestamp);
        emit NavUpdated(newNav);
    }

    function setGated(bool isGated) external onlyIssuer {
        gated = isGated;
        emit GateSet(isGated);
    }

    function setAllowlist(address account, bool allowed) external onlyIssuer {
        shareToken.setAllowlist(account, allowed);
    }

    function deposit(uint256 usdgAmount) external nonReentrant returns (uint256 sharesOut) {
        if (usdgAmount == 0) revert ZeroAmount();
        sharesOut = usdgAmount * 1e18 / nav;
        if (sharesOut == 0) revert ZeroAmount();
        if (!shareToken.allowlist(msg.sender)) shareToken.setAllowlist(msg.sender, true);
        shareToken.mint(msg.sender, sharesOut);
        UsdgTransfers.pull(token, msg.sender, address(this), usdgAmount);
        emit SharesDeposited(msg.sender, sharesOut, usdgAmount);
    }

    function depositCash(uint256 usdgAmount) external nonReentrant {
        if (usdgAmount == 0) revert ZeroAmount();
        UsdgTransfers.pull(token, msg.sender, address(this), usdgAmount);
        emit CashDeposited(msg.sender, usdgAmount);
    }

    function requestRedeem(uint256 shares_) external nonReentrant returns (uint256 requestId) {
        return _queue(msg.sender, shares_);
    }

    function exitEarly(uint256 requestId, uint256 minUsdgOut) external nonReentrant returns (uint256 usdgOut) {
        return _exit(msg.sender, requestId, minUsdgOut);
    }

    function exitNow(uint256 shares_, uint256 minUsdgOut)
        external
        nonReentrant
        returns (uint256 requestId, uint256 usdgOut)
    {
        requestId = _queue(msg.sender, shares_);
        usdgOut = _exit(msg.sender, requestId, minUsdgOut);
    }

    function cancel(uint256 requestId) external nonReentrant {
        Request storage request = _requests[requestId];
        if (request.owner != msg.sender) revert NotOwner();
        if (request.status != RequestStatus.Queued) revert BadStatus();
        request.status = RequestStatus.Cancelled;
        queuedValue -= request.navValue;
        queueLength -= 1;
        _removeOpen(requestId);
        shareToken.pull(address(this), request.owner, request.shares);
        emit RequestCancelled(requestId);
    }

    function processWindow() external virtual nonReentrant {
        _process();
    }

    function quoteExit(uint256 shares_)
        external
        view
        returns (uint256 navValue, uint256 fee, uint256 usdgOut, bool available, string memory reason)
    {
        return _quote(Math.mulDiv(shares_, nav, 1e18));
    }

    function quoteRequest(uint256 requestId)
        external
        view
        returns (uint256 navValue, uint256 fee, uint256 usdgOut, bool available, string memory reason)
    {
        Request storage request = _requests[requestId];
        if (request.status != RequestStatus.Queued) return (request.navValue, 0, 0, false, "not queued");
        return _quote(request.navValue);
    }

    function getRequest(uint256 id) external view returns (Request memory) {
        return _requests[id];
    }

    function requestsOf(address owner_) external view returns (uint256[] memory) {
        return _owned[owner_];
    }

    function lockgateOwed() public view returns (uint256 owed) {
        for (uint256 id = firstOpen; id != 0; id = nextOpen[id]) {
            uint256 advanceId = _requests[id].advanceId;
            if (advanceId != 0) owed += line.remainingOf(advanceId);
        }
    }

    function headRequestId() external view returns (uint256) {
        for (uint256 id = firstOpen; id != 0; id = nextOpen[id]) {
            if (_requests[id].status == RequestStatus.Queued) return id;
        }
        return 0;
    }

    function previewSettlement()
        external
        view
        returns (uint256 cashBalance, uint256 repayFirst, uint256 queuePayable, uint256 queueShortfall)
    {
        cashBalance = cash();
        repayFirst = lockgateOwed();
        uint256 room = cashBalance > repayFirst ? cashBalance - repayFirst : 0;
        if (room == 0 || queuedValue == 0) return (cashBalance, repayFirst, 0, queuedValue);
        queuePayable = kind() == QueueKind.Epoch ? (room < queuedValue ? room : queuedValue) : _fifoFit(room);
        queueShortfall = queuedValue - queuePayable;
    }

    function _process() internal {
        if (block.timestamp < nextWindow) revert WindowClosed();
        bool clear = _repayFirst();
        _closeAdvances();
        if (!clear) {
            emit WindowProcessed(currentCycleId, nextWindow, false);
            return;
        }
        _payQueue();
        currentCycleId += 1;
        nextWindow += windowInterval;
        emit WindowProcessed(currentCycleId, nextWindow, true);
    }

    function _payQueue() internal virtual {
        _payFifo();
    }

    function _queue(address owner_, uint256 shares_) internal returns (uint256 id) {
        if (gated) revert Gated();
        if (shares_ == 0) revert ZeroAmount();
        uint256 navValue = Math.mulDiv(shares_, nav, 1e18);
        if (navValue == 0) revert ZeroAmount();
        id = ++requestCount;
        _requests[id] = Request({
            owner: owner_,
            shares: shares_,
            navValue: navValue,
            requestedAt: uint64(block.timestamp),
            status: RequestStatus.Queued,
            advanceId: 0
        });
        requestCycle[id] = currentCycleId;
        _owned[owner_].push(id);
        queuedValue += navValue;
        queueLength += 1;
        _pushOpen(id);
        shareToken.pull(owner_, address(this), shares_);
        emit RedeemRequested(id, owner_, shares_, navValue);
    }

    function _exit(address owner_, uint256 requestId, uint256 minUsdgOut) internal returns (uint256 usdgOut) {
        Request storage request = _requests[requestId];
        if (request.owner != owner_) revert NotOwner();
        if (request.status != RequestStatus.Queued) revert BadStatus();
        (uint256 navValue,, uint256 out, bool available, string memory reason) = _quote(request.navValue);
        if (!available) revert NotAvailable(reason);
        if (out < minUsdgOut) revert Slippage();
        (uint256 advanceId, uint256 charged) = line.draw(navValue, owner_, navValue - minUsdgOut);
        request.status = RequestStatus.Advanced;
        request.advanceId = advanceId;
        queuedValue -= navValue;
        queueLength -= 1;
        usdgOut = navValue - charged;
        emit ExitAdvanced(requestId, advanceId, usdgOut, charged);
    }

    function _quote(uint256 navValue)
        internal
        view
        returns (uint256, uint256 fee, uint256 usdgOut, bool available, string memory reason)
    {
        if (navValue == 0) return (0, 0, 0, false, "zero");
        if (gated) return (navValue, 0, 0, false, "gated");
        (fee,, available, reason) = line.quote(address(this), navValue);
        if (!available) return (navValue, fee, 0, false, reason);
        if (fee >= navValue) return (navValue, fee, 0, false, "fee consumes value");
        return (navValue, fee, navValue - fee, true, "");
    }

    function _repayFirst() internal returns (bool) {
        for (uint256 id = firstOpen; id != 0; id = nextOpen[id]) {
            uint256 advanceId = _requests[id].advanceId;
            if (advanceId == 0) continue;
            uint256 remaining = line.remainingOf(advanceId);
            if (remaining == 0) continue;
            if (cash() < remaining) return false;
            line.repay(advanceId);
        }
        return true;
    }

    function _closeAdvances() internal {
        uint256 id = firstOpen;
        while (id != 0) {
            uint256 nxt = nextOpen[id];
            Request storage request = _requests[id];
            if (
                request.status == RequestStatus.Advanced && request.shares != 0
                    && line.remainingOf(request.advanceId) == 0
            ) {
                shareToken.burn(address(this), request.shares);
                request.shares = 0;
                emit AdvanceClosed(id, request.advanceId);
                _removeOpen(id);
            }
            id = nxt;
        }
    }

    function _payFifo() internal {
        uint256 id = firstOpen;
        while (id != 0) {
            uint256 nxt = nextOpen[id];
            if (_requests[id].status == RequestStatus.Queued) {
                if (cash() < _requests[id].navValue) return;
                _payAmount(id, _requests[id].navValue);
            }
            id = nxt;
        }
    }

    function _payProRata() internal {
        uint256 total = queuedValue;
        if (total == 0) return;
        uint256 bal = cash();
        if (bal >= total) {
            _payFifo();
            return;
        }
        if (bal == 0) return;
        uint256 id = firstOpen;
        while (id != 0) {
            uint256 nxt = nextOpen[id];
            if (_requests[id].status == RequestStatus.Queued) {
                _payAmount(id, _requests[id].navValue * bal / total);
            }
            id = nxt;
        }
    }

    function _payAmount(uint256 id, uint256 amount) internal {
        Request storage request = _requests[id];
        if (amount == 0 || request.status != RequestStatus.Queued) return;
        if (amount > request.navValue) amount = request.navValue;
        uint256 sharesOut = amount == request.navValue ? request.shares : request.shares * amount / request.navValue;
        if (sharesOut == 0) return;
        UsdgTransfers.push(token, request.owner, amount);
        shareToken.burn(address(this), sharesOut);
        request.shares -= sharesOut;
        request.navValue -= amount;
        queuedValue -= amount;
        if (request.shares == 0 && request.navValue != 0) {
            queuedValue -= request.navValue;
            request.navValue = 0;
        }
        if (request.navValue == 0) {
            queueLength -= 1;
            request.status = RequestStatus.Paid;
            _removeOpen(id);
            emit RequestPaid(id, request.owner, amount);
        } else {
            emit RequestPartPaid(id, amount, request.navValue);
        }
    }

    function _fifoFit(uint256 room) internal view returns (uint256 pay) {
        for (uint256 id = firstOpen; id != 0; id = nextOpen[id]) {
            if (_requests[id].status != RequestStatus.Queued) continue;
            if (room < _requests[id].navValue) break;
            pay += _requests[id].navValue;
            room -= _requests[id].navValue;
        }
    }
}
