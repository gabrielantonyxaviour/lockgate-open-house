// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {CoreFixture} from "./Support.sol";
import {OpenCreditVault} from "../../src/core/OpenCreditVault.sol";
import {LockgateExitPool} from "../../src/core/LockgateExitPool.sol";
import {ILockgateExitPool} from "../../src/interfaces/ILockgateExitPool.sol";
import {ILockgateCreditLine} from "../../src/interfaces/ILockgateCreditLine.sol";

contract DoorTwoTest is CoreFixture {
    OpenCreditVault internal vault;
    LockgateExitPool internal pool;

    function setUp() public {
        _core();
        vault = new OpenCreditVault(owner, address(usdg), true);
        vm.prank(owner);
        usdg.setMinter(address(vault), true);
        pool = new LockgateExitPool(owner, address(vault), address(line));
        vm.prank(owner);
        line.registerSource(address(pool), 1_000_000e6, 0);
    }

    function test_sellThenSettleRepaysTheFace() public {
        uint256 shares = _deposit(investor, 100e6);
        vm.prank(investor);
        (uint256 quoted,, uint256 preview, bool ok,) = pool.quote(shares);
        assertTrue(ok);
        assertEq(quoted, 100e6);
        assertEq(preview, 100e6 - 490_000);
        uint256 beforeBal = usdg.balanceOf(investor);
        vm.prank(investor);
        (uint256 id, uint256 payout) = pool.sellToLockgate(shares, preview);
        assertEq(payout, 99_510_000);
        assertEq(usdg.balanceOf(investor) - beforeBal, payout);
        ILockgateExitPool.Position memory position = pool.getPosition(id);
        assertEq(position.fee, 490_000);
        assertEq(position.navValue, 100e6);
        assertEq(line.exposure(address(pool)), 100e6);
        assertEq(line.requiredReserve(address(pool)), 0);
        assertEq(line.eligibleOutstanding(), 100e6);
        vm.expectRevert(LockgateExitPool.NotReady.selector);
        pool.settle(id);
        vm.warp(position.readyAt);
        pool.settle(id);
        assertTrue(pool.getPosition(id).settled);
        assertEq(line.remainingOf(position.advanceId), 0);
        assertEq(line.earnedFees(), 490_000);
        assertEq(line.eligibleOutstanding(), 0);
        assertEq(usdg.balanceOf(address(pool)), 0);
        assertEq(line.accountedAssets(), line.accountedEquity());
        vm.expectRevert(LockgateExitPool.AlreadySettled.selector);
        pool.settle(id);
        vm.expectRevert(OpenCreditVault.AlreadyClaimed.selector);
        vault.claim(position.withdrawalId);
    }

    function test_gateSlippageAndLateSettle() public {
        uint256 shares = _deposit(investor, 100e6);
        vm.prank(owner);
        pool.setGated(true);
        (,,, bool ok, string memory why) = pool.quote(shares);
        assertFalse(ok);
        assertEq(why, "gated");
        vm.prank(investor);
        vm.expectRevert(LockgateExitPool.Gated.selector);
        pool.sellToLockgate(shares, 0);
        vm.prank(owner);
        pool.setGated(false);
        vm.prank(investor);
        vm.expectRevert(LockgateExitPool.Slippage.selector);
        pool.sellToLockgate(shares, type(uint256).max);
        vm.prank(investor);
        (uint256 id,) = pool.sellToLockgate(shares, 0);
        uint256 advanceId = pool.getPosition(id).advanceId;
        uint64 due = line.getAdvance(advanceId).dueAt;
        vm.warp(uint256(due) + line.grace());
        line.markLate(advanceId);
        assertEq(uint256(line.getAdvance(advanceId).status), uint256(ILockgateCreditLine.AdvanceStatus.Late));
        assertEq(line.lateOutstanding(), 100e6);
        pool.settle(id);
        assertEq(line.lateOutstanding(), 0);
        assertEq(line.earnedFees(), 490_000);
        assertEq(uint256(line.getAdvance(advanceId).status), uint256(ILockgateCreditLine.AdvanceStatus.Late));
    }

    function test_oneYearOfMockYieldIsNinePercent() public {
        _deposit(investor, 100e6);
        uint256 year = vault.YEAR();
        vm.warp(1 + year);
        vault.accrue();
        assertEq(vault.assets(), 109e6);
        assertEq(vault.nav(), 1_090_000);
        assertEq(usdg.balanceOf(address(vault)), 109e6);
    }

    function testFuzz_yieldMatchesTheApr(uint96 amount, uint32 elapsed) public {
        amount = uint96(bound(amount, 1e6, 1_000_000e6));
        elapsed = uint32(bound(elapsed, 1, 365 days));
        _deposit(investor, amount);
        uint256 expected = uint256(amount) * vault.APR_BPS() * elapsed / (vault.BPS() * vault.YEAR());
        vm.warp(1 + uint256(elapsed));
        vault.accrue();
        assertEq(vault.assets(), uint256(amount) + expected);
        assertEq(usdg.balanceOf(address(vault)), vault.assets() + vault.reserved());
    }

    function testFuzz_sellSettleReturnsTheFace(uint96 amount) public {
        amount = uint96(bound(amount, 1e6, 50_000e6));
        uint256 shares = _deposit(investor, amount);
        vm.prank(investor);
        (uint256 id, uint256 payout) = pool.sellToLockgate(shares, 0);
        ILockgateExitPool.Position memory position = pool.getPosition(id);
        assertEq(payout + position.fee, amount);
        assertEq(line.exposure(address(pool)), amount);
        assertEq(line.eligibleOutstanding(), amount);
        vm.warp(position.readyAt);
        pool.settle(id);
        assertEq(line.exposure(address(pool)), 0);
        assertEq(line.earnedFees(), position.fee);
        assertEq(usdg.balanceOf(address(pool)), 0);
        assertEq(usdg.balanceOf(address(vault)), vault.assets() + vault.reserved());
        assertEq(line.accountedAssets(), line.accountedEquity());
        assertEq(line.eligibleOutstanding() + line.lateOutstanding(), line.totalExposure());
    }

    function test_accessZeroAndRealTokenDoesNotMintYield() public {
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger));
        pool.setGated(true);
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger));
        vault.setCooldown(1 hours);
        vm.prank(owner);
        vm.expectRevert(OpenCreditVault.BadParam.selector);
        vault.setCooldown(0);
        (uint256 navValue, uint256 fee, uint256 usdgOut, bool ok, string memory why) = pool.quote(0);
        assertEq(navValue, 0);
        assertEq(fee, 0);
        assertEq(usdgOut, 0);
        assertFalse(ok);
        assertEq(why, "zero");
        vm.expectRevert(LockgateExitPool.ZeroAmount.selector);
        pool.sellToLockgate(0, 0);
        vm.expectRevert(LockgateExitPool.UnknownPosition.selector);
        pool.settle(1);

        OpenCreditVault quiet = new OpenCreditVault(owner, address(usdg), false);
        _mint(investor, 100e6);
        vm.startPrank(investor);
        usdg.approve(address(quiet), 100e6);
        quiet.deposit(100e6);
        vm.stopPrank();
        uint256 year = vault.YEAR();
        vm.warp(1 + year);
        quiet.accrue();
        assertEq(quiet.assets(), 100e6);
        assertEq(quiet.nav(), 1_000_000);
        assertEq(usdg.balanceOf(address(quiet)), 100e6);
    }

    function test_depositReentrancyReverts() public {
        ReenterToken token = new ReenterToken();
        OpenCreditVault boxed = new OpenCreditVault(owner, address(token), false);
        token.arm(address(boxed));
        token.mint(investor, 10e6);
        vm.startPrank(investor);
        token.approve(address(boxed), 10e6);
        vm.expectRevert(ReentrancyGuard.ReentrancyGuardReentrantCall.selector);
        boxed.deposit(10e6);
        vm.stopPrank();
        assertEq(boxed.totalSupply(), 0);
        assertEq(boxed.assets(), 0);
    }

    function _deposit(address account, uint256 amount) internal returns (uint256 shares) {
        _mint(account, amount);
        vm.startPrank(account);
        usdg.approve(address(vault), amount);
        shares = vault.deposit(amount);
        usdg.approve(address(pool), 0);
        OpenCreditVault(address(vault)).approve(address(pool), shares);
        vm.stopPrank();
    }
}

/// @notice `transferFrom` into the vault calls `deposit` again.
contract ReenterToken is ERC20 {
    OpenCreditVault public vault;
    bool internal armed;

    constructor() ERC20("reenter", "RE") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function arm(address vault_) external {
        vault = OpenCreditVault(vault_);
        armed = true;
    }

    function _update(address from, address to, uint256 value) internal override {
        if (armed && from != address(0) && to == address(vault)) {
            armed = false;
            vault.deposit(1);
        }
        super._update(from, to, value);
    }
}
