// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @title MockUSDG
/// @notice 6-decimal test USDG. The faucet cap is per call, so a demo can mint again. That is intentional.
contract MockUSDG is ERC20, Ownable {
    uint8 private constant DECIMALS = 6;
    uint256 public constant FAUCET_MAX = 10_000e6;

    mapping(address => bool) public minters;

    error FaucetCap(uint256 amount);
    error NotMinter();
    error ZeroAddress();

    event MinterSet(address indexed account, bool allowed);
    event Faucet(address indexed to, uint256 amount);
    event Minted(address indexed to, uint256 amount);

    constructor(address owner_) ERC20("test USDG", "USDG") Ownable(owner_) {
        if (owner_ == address(0)) revert ZeroAddress();
        minters[owner_] = true;
        emit MinterSet(owner_, true);
    }

    function decimals() public pure override returns (uint8) {
        return DECIMALS;
    }

    /// @notice Owner grants or revokes uncapped minting. The fund factory needs this.
    function setMinter(address account, bool allowed) external onlyOwner {
        if (account == address(0)) revert ZeroAddress();
        minters[account] = allowed;
        emit MinterSet(account, allowed);
    }

    /// @notice Anyone. Reverts above 10_000 tokens per call.
    function faucet(uint256 amount) external {
        if (amount > FAUCET_MAX) revert FaucetCap(amount);
        _mint(msg.sender, amount);
        emit Faucet(msg.sender, amount);
    }

    /// @notice Minters only. Used to seed sandbox funds.
    function mint(address to, uint256 amount) external {
        if (!minters[msg.sender]) revert NotMinter();
        if (to == address(0)) revert ZeroAddress();
        _mint(to, amount);
        emit Minted(to, amount);
    }
}
