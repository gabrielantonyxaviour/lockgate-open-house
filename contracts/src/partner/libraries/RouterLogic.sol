// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {FeeMath} from "./FeeMath.sol";

/// @title RouterLogic
/// @notice Pure vault selection. `maxNav` is the amount a vault already said it can fund.
library RouterLogic {
    struct Candidate {
        address vault;
        uint256 maxNav;
        uint16 feeBps;
        uint256 idle;
    }

    struct Slice {
        address vault;
        uint256 navValue;
        uint256 fee;
        uint16 feeBps;
    }

    function best(Candidate[] memory rows, uint256 nav) internal pure returns (Slice memory pick, bool ok) {
        uint256 bestIdle;
        address bestVault;
        uint16 bestBps = type(uint16).max;
        uint256 n = rows.length;
        for (uint256 i; i < n; ++i) {
            if (rows[i].maxNav < nav || nav == 0 || rows[i].feeBps >= FeeMath.BPS) continue;
            if (rows[i].feeBps < bestBps || (rows[i].feeBps == bestBps && rows[i].idle > bestIdle)) {
                bestBps = rows[i].feeBps;
                bestIdle = rows[i].idle;
                bestVault = rows[i].vault;
                ok = true;
            }
        }
        if (!ok) return (pick, false);
        pick = _slice(bestVault, nav, bestBps);
    }

    function robin(Candidate[] memory rows, uint256 nav, uint256 cursor)
        internal
        pure
        returns (Slice memory pick, uint256 index, bool ok)
    {
        uint256 n = rows.length;
        if (n == 0 || nav == 0) return (pick, 0, false);
        for (uint256 step; step < n; ++step) {
            uint256 i = (cursor + step) % n;
            if (rows[i].maxNav >= nav && rows[i].feeBps < FeeMath.BPS) {
                return (_slice(rows[i].vault, nav, rows[i].feeBps), i, true);
            }
        }
    }

    /// @dev Splits `nav` across candidates in proportion to `maxNav`. Sum of slices equals the filled amount.
    function proRata(Candidate[] memory rows, uint256 nav) internal pure returns (Slice[] memory filled) {
        uint256 n = rows.length;
        uint256 total;
        for (uint256 i; i < n; ++i) {
            if (rows[i].feeBps < FeeMath.BPS) total += rows[i].maxNav;
        }
        if (total == 0 || nav == 0) return new Slice[](0);
        uint256 target = nav < total ? nav : total;
        Slice[] memory tmp = new Slice[](n);
        uint256 count;
        uint256 used;
        for (uint256 i; i < n; ++i) {
            if (rows[i].maxNav == 0 || rows[i].feeBps >= FeeMath.BPS) continue;
            uint256 part = Math.mulDiv(target, rows[i].maxNav, total);
            if (part > rows[i].maxNav) part = rows[i].maxNav;
            if (part == 0) continue;
            tmp[count] = _slice(rows[i].vault, part, rows[i].feeBps);
            used += part;
            ++count;
        }
        uint256 dust = target - used;
        for (uint256 i; i < count && dust > 0; ++i) {
            uint256 room = _room(rows, tmp[i].vault, tmp[i].navValue);
            if (room == 0) continue;
            uint256 add = dust < room ? dust : room;
            tmp[i] = _slice(tmp[i].vault, tmp[i].navValue + add, tmp[i].feeBps);
            dust -= add;
        }
        filled = new Slice[](count);
        for (uint256 i; i < count; ++i) filled[i] = tmp[i];
    }

    function _room(Candidate[] memory rows, address vault, uint256 usedNav) private pure returns (uint256) {
        uint256 n = rows.length;
        for (uint256 i; i < n; ++i) {
            if (rows[i].vault == vault) {
                return rows[i].maxNav > usedNav ? rows[i].maxNav - usedNav : 0;
            }
        }
        return 0;
    }

    function _slice(address vault, uint256 nav, uint16 bps) private pure returns (Slice memory s) {
        uint256 fee = FeeMath.mulDivHalfUp(nav, bps, FeeMath.BPS);
        if (fee >= nav) fee = nav - 1;
        s = Slice(vault, nav, fee, bps);
    }
}
