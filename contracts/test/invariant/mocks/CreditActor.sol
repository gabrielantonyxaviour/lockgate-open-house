// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ICreditSource} from "../../../src/interfaces/ICreditSource.sol";
import {LockgateCreditLine} from "../../../src/core/LockgateCreditLine.sol";

/// @notice Platform stand-in. Draws and repayments are sent by this contract, so the credit line
///         sees the platform as `msg.sender` / `advance.source`.
contract CreditActor is ICreditSource {
    LockgateCreditLine public immutable line;
    IERC20 public immutable token;
    address public immutable investor;

    bool public gated;
    uint64 public navUpdatedAt;
    uint64 public nextWindow;
    uint256 public nav = 1e18;

    constructor(LockgateCreditLine line_, IERC20 token_, address investor_) {
        line = line_;
        token = token_;
        investor = investor_;
        navUpdatedAt = uint64(block.timestamp);
        nextWindow = uint64(block.timestamp + 600);
        token_.approve(address(line_), type(uint256).max);
    }

    function refresh(uint64 windowIn) external {
        gated = false;
        navUpdatedAt = uint64(block.timestamp);
        nextWindow = uint64(block.timestamp + windowIn);
    }

    function setGated(bool next) external {
        gated = next;
    }

    function setNavUpdatedAt(uint64 at) external {
        navUpdatedAt = at;
    }

    function postReserve(uint256 amount) external {
        line.postReserve(address(this), amount);
    }

    function draw(uint256 navValue) external returns (uint256 id, uint256 fee) {
        return line.draw(navValue, investor, type(uint256).max);
    }

    function repay(uint256 id) external {
        line.repay(id);
    }
}
