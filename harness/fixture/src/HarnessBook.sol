// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Harness receivables book. LockgateCreditLine does not yet expose
///         eligibleOutstanding/lateOutstanding (see contracts/INTERFACE-REQUESTS.md).
///         This scanner is test infrastructure. It is not the protocol book.
contract HarnessBook {
    enum Status { Active, Repaid, Late }

    struct Advance {
        address source;
        address to;
        uint256 principal;
        uint256 fee;
        uint64 drawnAt;
        uint64 dueAt;
        Status status;
    }

    address public immutable line;

    error ZeroAddress();

    constructor(address line_) {
        if (line_ == address(0)) revert ZeroAddress();
        line = line_;
    }

    function eligibleOutstanding() external view returns (uint256) {
        return _sum(Status.Active);
    }

    function lateOutstanding() external view returns (uint256) {
        return _sum(Status.Late);
    }

    function _sum(Status wanted) private view returns (uint256 total) {
        uint256 n = _count();
        for (uint256 id = 1; id <= n; ++id) {
            (uint256 principal, uint8 status) = _row(id);
            if (status != uint8(wanted)) continue;
            uint256 recovered = _recovered(id);
            if (principal > recovered) total += principal - recovered;
        }
    }

    function _count() private view returns (uint256 n) {
        (bool ok, bytes memory data) = line.staticcall(abi.encodeWithSignature("advanceCount()"));
        if (!ok || data.length < 32) return 0;
        n = abi.decode(data, (uint256));
    }

    function _recovered(uint256 id) private view returns (uint256 recovered) {
        (bool ok, bytes memory data) = line.staticcall(abi.encodeWithSignature("recoveredOf(uint256)", id));
        if (!ok || data.length < 32) return 0;
        recovered = abi.decode(data, (uint256));
    }

    function _row(uint256 id) private view returns (uint256 principal, uint8 status) {
        (bool ok, bytes memory data) = line.staticcall(abi.encodeWithSignature("getAdvance(uint256)", id));
        if (!ok || data.length < 32) return (0, 0);
        Advance memory advance = abi.decode(data, (Advance));
        return (advance.principal, uint8(advance.status));
    }
}
