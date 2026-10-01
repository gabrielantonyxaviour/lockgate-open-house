// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Partner wallet. Only digests the partner has allowed return the ERC-1271 magic value.
contract ERC1271Signer {
    bytes4 internal constant MAGIC = 0x1626ba7e;
    mapping(bytes32 => bool) public allowed;

    function allow(bytes32 hash) external {
        allowed[hash] = true;
    }

    function isValidSignature(bytes32 hash, bytes memory) external view returns (bytes4) {
        return allowed[hash] ? MAGIC : bytes4(0);
    }
}
