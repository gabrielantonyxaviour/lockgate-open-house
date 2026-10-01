// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

/// @title FeeMath
/// @notice Fee rounding shared with the off-chain engine (`mulDivRoundHalfUp` in engine/src/money.ts).
library FeeMath {
    uint256 internal constant BPS = 10_000;

    /// @dev floor(a * b / d + 1/2). Remainder ties round up.
    function mulDivHalfUp(uint256 a, uint256 b, uint256 denom) internal pure returns (uint256) {
        uint256 floor = Math.mulDiv(a, b, denom);
        uint256 rem = mulmod(a, b, denom);
        if (rem >= denom - rem) return floor + 1;
        return floor;
    }

    /// @notice Minimum fee the vault will accept for `minFeeBps`. One atomic unit below this reverts.
    function minFee(uint256 navValue, uint256 minFeeBps) internal pure returns (uint256) {
        return Math.mulDiv(navValue, minFeeBps, BPS);
    }
}
