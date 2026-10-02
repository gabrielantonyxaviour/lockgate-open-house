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

    /// @dev Proportional floor, then leftover units. Fuller slices take them first.
    ///      A cap the floor skipped still takes a unit once those slices are full.
    ///      Sum of `navValue` equals the filled amount. The fee is the half-up fee of that final nav.
    function proRata(Candidate[] memory rows, uint256 nav) internal pure returns (Slice[] memory filled) {
        uint256 n = rows.length;
        uint256 total;
        for (uint256 i; i < n; ++i) {
            if (rows[i].feeBps < FeeMath.BPS) total += rows[i].maxNav;
        }
        if (total == 0 || nav == 0) return new Slice[](0);
        uint256 target = nav < total ? nav : total;
        uint256[] memory taken = new uint256[](n);
        uint256 used;
        for (uint256 i; i < n; ++i) {
            if (rows[i].maxNav == 0 || rows[i].feeBps >= FeeMath.BPS) continue;
            uint256 part = Math.mulDiv(target, rows[i].maxNav, total);
            if (part > rows[i].maxNav) part = rows[i].maxNav;
            taken[i] = part;
            used += part;
        }
        uint256 dust = target - used;
        dust = _pour(rows, taken, dust, true);
        if (dust > 0) _pour(rows, taken, dust, false);
        uint256 count;
        for (uint256 i; i < n; ++i) {
            if (taken[i] > 0) ++count;
        }
        filled = new Slice[](count);
        uint256 w;
        for (uint256 i; i < n; ++i) {
            if (taken[i] == 0) continue;
            filled[w] = _slice(rows[i].vault, taken[i], rows[i].feeBps);
            ++w;
        }
    }

    /// @dev `positive` tops up slices that already have a floor share. The other pass fills caps that rounded to zero.
    function _pour(Candidate[] memory rows, uint256[] memory taken, uint256 dust, bool positive)
        private
        pure
        returns (uint256)
    {
        uint256 n = rows.length;
        for (uint256 i; i < n && dust > 0; ++i) {
            if (rows[i].maxNav == 0 || rows[i].feeBps >= FeeMath.BPS) continue;
            if (positive != (taken[i] > 0)) continue;
            uint256 room = rows[i].maxNav - taken[i];
            if (room == 0) continue;
            uint256 add = dust < room ? dust : room;
            taken[i] += add;
            dust -= add;
        }
        return dust;
    }

    function _slice(address vault, uint256 nav, uint16 bps) private pure returns (Slice memory s) {
        uint256 fee = FeeMath.mulDivHalfUp(nav, bps, FeeMath.BPS);
        if (fee >= nav) fee = nav - 1;
        s = Slice(vault, nav, fee, bps);
    }
}
