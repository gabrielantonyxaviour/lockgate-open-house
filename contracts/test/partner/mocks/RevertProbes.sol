// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Advance, AdvanceStatus} from "../../../src/partner/Types.sol";

contract ShortWord {
    fallback() external {
        assembly {
            return(0, 16)
        }
    }
}

contract RouterProbe {
    address public owner;
    address internal asset_;
    bool public failOwed;
    bool public failAsset;
    address public platform;
    bytes32 public exitRef;

    constructor(address owner_, address platform_, bytes32 exitRef_) {
        owner = owner_;
        platform = platform_;
        exitRef = exitRef_;
    }

    function setFailOwed(bool next) external {
        failOwed = next;
    }

    function setFailAsset(bool next) external {
        failAsset = next;
    }

    function setAsset(address next) external {
        asset_ = next;
    }

    function asset() external view returns (address) {
        if (failAsset) revert();
        return asset_;
    }

    function owedOf(uint256) external view returns (uint256) {
        if (failOwed) revert();
        return 5;
    }

    function repay(uint256) external {}

    function getAdvance(uint256) external view returns (Advance memory advance) {
        advance.platform = platform;
        advance.exitRef = exitRef;
        advance.navValue = 10;
        advance.fee = 1;
        advance.status = AdvanceStatus.Active;
    }
}

contract HeldToken {
    mapping(address => uint256) public balanceOf;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function approve(address, uint256) external pure returns (bool) {
        return true;
    }
}
