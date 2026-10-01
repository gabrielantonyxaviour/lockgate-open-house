// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title MockUSDG
/// @notice 6-decimal test USDG. `faucet` is capped per SPEC.md. `mint` is the deployer only.
contract MockUSDG {
    string public constant name = "test USDG";
    string public constant symbol = "USDG";
    uint8 public constant decimals = 6;
    uint256 public constant FAUCET_MAX = 10_000e6;

    address public immutable minter;
    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    error NotMinter();
    error FaucetCap();
    error Balance();
    error Allowance();

    event Transfer(address indexed from, address indexed to, uint256 amount);
    event Approval(address indexed owner, address indexed spender, uint256 amount);
    event Mint(address indexed to, uint256 amount);
    event Faucet(address indexed to, uint256 amount);

    constructor(address minter_) {
        if (minter_ == address(0)) revert NotMinter();
        minter = minter_;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        _transfer(msg.sender, to, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 allowed = allowance[from][msg.sender];
        if (allowed != type(uint256).max) {
            if (allowed < amount) revert Allowance();
            allowance[from][msg.sender] = allowed - amount;
            emit Approval(from, msg.sender, allowance[from][msg.sender]);
        }
        _transfer(from, to, amount);
        return true;
    }

    /// @notice Anyone. At most 10_000 USDG per call (SPEC.md).
    function faucet(uint256 amount) external {
        if (amount == 0 || amount > FAUCET_MAX) revert FaucetCap();
        _mint(msg.sender, amount);
        emit Faucet(msg.sender, amount);
    }

    function mint(address to, uint256 amount) external {
        if (msg.sender != minter) revert NotMinter();
        _mint(to, amount);
        emit Mint(to, amount);
    }

    function _mint(address to, uint256 amount) internal {
        totalSupply += amount;
        balanceOf[to] += amount;
        emit Transfer(address(0), to, amount);
    }

    function _transfer(address from, address to, uint256 amount) internal {
        if (balanceOf[from] < amount) revert Balance();
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        emit Transfer(from, to, amount);
    }
}
