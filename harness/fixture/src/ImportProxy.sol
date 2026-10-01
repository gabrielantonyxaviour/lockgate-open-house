// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

/// @notice Compiles ERC1967Proxy into this fixture's artifacts. Not deployed itself.
contract ImportProxy {
    function proxyCode() external pure returns (bytes memory) {
        return type(ERC1967Proxy).creationCode;
    }
}
