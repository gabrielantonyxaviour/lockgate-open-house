// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Permissionless CREATE2 factory. Addresses depend on salt and bytecode, not on msg.sender.
contract Create2Factory {
    error DeployFailed();

    event Deployed(bytes32 indexed salt, address indexed addr, address indexed caller);

    function deploy(bytes32 salt, bytes memory code) external returns (address addr) {
        assembly {
            addr := create2(0, add(code, 0x20), mload(code), salt)
        }
        if (addr == address(0) || addr.code.length == 0) revert DeployFailed();
        emit Deployed(salt, addr, msg.sender);
    }
}
