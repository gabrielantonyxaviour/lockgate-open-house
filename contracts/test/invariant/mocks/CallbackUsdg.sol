// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {CreditActor} from "./CreditActor.sol";

/// @notice 6-decimal token that can reenter a draw or deliver one unit short.
contract CallbackUsdg {
    uint8 public constant decimals = 6;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    address public callbackActor;
    uint256 public callbackNav;
    uint256 public shortfall;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function arm(address actor, uint256 nav) external {
        callbackActor = actor;
        callbackNav = nav;
    }

    function setShortfall(uint256 next) external {
        shortfall = next;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        _move(msg.sender, to, amount);
        if (callbackActor != address(0)) {
            address actor = callbackActor;
            uint256 nav = callbackNav;
            callbackActor = address(0);
            CreditActor(actor).draw(nav);
        }
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 allowed = allowance[from][msg.sender];
        if (allowed != type(uint256).max) allowance[from][msg.sender] = allowed - amount;
        uint256 delivered = amount - shortfall;
        _move(from, to, delivered);
        return true;
    }

    function _move(address from, address to, uint256 amount) internal {
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
    }
}
