// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {AdvanceProposal} from "../../src/interfaces/IAdvanceProposal.sol";
import {PartnerRouter} from "../../src/partner/PartnerRouter.sol";
import {PartnerVault} from "../../src/partner/PartnerVault.sol";
import {PartnerVaultAdmin} from "../../src/partner/PartnerVaultAdmin.sol";
import {VaultFixture} from "./VaultFixture.sol";
import {TokenAttacker, WeirdUSDG} from "./mocks/WeirdUSDG.sol";

contract PartnerTokenTest is VaultFixture {
    function setUp() public {
        _deploy();
    }

    function test_feeOnTransferRejectsPullsAndPushes() public {
        (PartnerVault v, WeirdUSDG token) = _weird();
        _give(v, token, partner, 100_000 * UNIT);
        _give(v, token, platform, 5_000 * UNIT);
        uint256 id = _pay(v, 10_000 * UNIT, 1);
        uint256 owed = v.owedOf(id);
        uint256 idle = v.idle();
        uint256 reserve = v.reserveOf(platform);
        uint256 count = v.advanceCount();

        token.setKind(1);
        token.mint(partner, 1_000 * UNIT);
        vm.startPrank(partner);
        token.approve(address(v), type(uint256).max);
        vm.expectRevert(PartnerVaultAdmin.BalanceMismatch.selector);
        v.deposit(1_000 * UNIT);
        vm.stopPrank();

        token.mint(platform, 1_000 * UNIT);
        vm.startPrank(platform);
        token.approve(address(v), type(uint256).max);
        vm.expectRevert(PartnerVaultAdmin.BalanceMismatch.selector);
        v.postReserve(platform, 1_000 * UNIT);
        vm.stopPrank();

        token.mint(platform, owed);
        uint256 platformBal = token.balanceOf(platform);
        vm.startPrank(platform);
        token.approve(address(v), type(uint256).max);
        vm.expectRevert(PartnerVaultAdmin.BalanceMismatch.selector);
        v.repay(id);
        vm.stopPrank();

        uint256 partnerBal = token.balanceOf(partner);
        vm.prank(partner);
        vm.expectRevert(PartnerVaultAdmin.BalanceMismatch.selector);
        v.withdraw(UNIT, partner);

        vm.prank(platform);
        vm.expectRevert(PartnerVaultAdmin.BalanceMismatch.selector);
        v.withdrawReserve(platform, UNIT, platform);

        AdvanceProposal memory p = _proposal(1_000 * UNIT, 2);
        bytes memory sig = _engineSig(v, p);
        vm.prank(partner);
        vm.expectRevert(PartnerVaultAdmin.BalanceMismatch.selector);
        v.execute(p, sig, "");

        assertEq(v.idle(), idle);
        assertEq(v.reserveOf(platform), reserve);
        assertEq(v.owedOf(id), owed);
        assertEq(v.advanceCount(), count);
        assertEq(token.balanceOf(partner), partnerBal);
        assertEq(token.balanceOf(platform), platformBal);
        assertEq(token.balanceOf(address(v)), idle + reserve);

        token.setKind(0);
        token.setYank(true);
        vm.prank(partner);
        vm.expectRevert(PartnerVaultAdmin.BalanceMismatch.selector);
        v.withdraw(UNIT, partner);
        assertEq(v.idle(), idle);
        token.setYank(false);

        vm.prank(partner);
        v.withdraw(UNIT, partner);
        vm.prank(platform);
        v.repay(id);
        assertEq(v.owedOf(id), 0);
        assertEq(v.advanceCount(), count);
        assertEq(token.balanceOf(address(v)), v.idle() + v.reserveOf(platform));
    }

    function test_returnFalseMovesNoCash() public {
        (PartnerVault v, WeirdUSDG token) = _weird();
        token.setKind(2);
        bytes memory err = abi.encodeWithSelector(SafeERC20.SafeERC20FailedOperation.selector, address(token));

        token.mint(partner, 1_000 * UNIT);
        vm.startPrank(partner);
        token.approve(address(v), type(uint256).max);
        vm.expectRevert(err);
        v.deposit(1_000 * UNIT);
        vm.stopPrank();

        token.mint(platform, 1_000 * UNIT);
        vm.startPrank(platform);
        token.approve(address(v), type(uint256).max);
        vm.expectRevert(err);
        v.postReserve(platform, 1_000 * UNIT);
        vm.stopPrank();
        assertEq(v.idle(), 0);
        assertEq(v.reserveOf(platform), 0);
        assertEq(token.balanceOf(address(v)), 0);

        token.mint(address(v), 500 * UNIT);
        vm.prank(partner);
        assertEq(v.skim(), 500 * UNIT);
        assertEq(v.idle(), 500 * UNIT);

        vm.prank(partner);
        vm.expectRevert(err);
        v.withdraw(UNIT, partner);

        AdvanceProposal memory p = _proposal(100 * UNIT, 1);
        bytes memory sig = _engineSig(v, p);
        vm.prank(partner);
        vm.expectRevert(err);
        v.execute(p, sig, "");
        assertEq(v.idle(), 500 * UNIT);
        assertEq(v.advanceCount(), 0);
        assertEq(token.balanceOf(address(v)), 500 * UNIT);

        token.setKind(0);
        vm.prank(partner);
        v.withdraw(UNIT, partner);
        assertEq(v.idle(), 499 * UNIT);
        assertEq(token.balanceOf(partner), 1_000 * UNIT + UNIT);
    }

    function test_rebaseDownBricksUntilRestoredAndSurplusNeedsSkim() public {
        (PartnerVault v, WeirdUSDG token) = _weird();
        _give(v, token, partner, 1_000 * UNIT);
        token.rebase(address(v), UNIT, true);

        vm.prank(partner);
        vm.expectRevert(PartnerVaultAdmin.BalanceMismatch.selector);
        v.withdraw(UNIT, partner);
        vm.prank(partner);
        vm.expectRevert(PartnerVaultAdmin.BalanceMismatch.selector);
        v.deposit(UNIT);
        vm.prank(partner);
        vm.expectRevert(PartnerVaultAdmin.BalanceMismatch.selector);
        v.skim();
        assertEq(v.idle(), 1_000 * UNIT);
        assertEq(token.balanceOf(address(v)), 999 * UNIT);

        token.rebase(address(v), UNIT, false);
        vm.prank(partner);
        v.withdraw(UNIT, partner);
        assertEq(v.idle(), 999 * UNIT);

        token.rebase(address(v), 7 * UNIT, false);
        vm.prank(partner);
        vm.expectRevert(PartnerVaultAdmin.BalanceMismatch.selector);
        v.withdraw(UNIT, partner);
        assertEq(v.idle(), 999 * UNIT);

        vm.prank(partner);
        assertEq(v.skim(), 7 * UNIT);
        assertEq(v.idle(), 1_006 * UNIT);
        vm.prank(partner);
        v.withdraw(UNIT, partner);
        assertEq(v.idle(), 1_005 * UNIT);
        token.setClip(v.idle() + UNIT);
        vm.prank(partner);
        vm.expectRevert(PartnerVaultAdmin.BalanceMismatch.selector);
        v.deposit(UNIT);
        assertEq(token.balanceOf(address(v)), v.idle());
    }

    function test_reentrantHookCannotDoubleSpend() public {
        (PartnerVault v, WeirdUSDG token) = _weird();
        TokenAttacker attacker = new TokenAttacker();
        attacker.configure(address(v), address(0), platform, 0, bytes32(0));
        bytes4 guard = ReentrancyGuard.ReentrancyGuardReentrantCall.selector;

        token.mint(partner, 100_000 * UNIT);
        vm.prank(partner);
        token.approve(address(v), type(uint256).max);
        token.arm(address(attacker));
        vm.prank(partner);
        v.deposit(100_000 * UNIT);
        _guarded(attacker, guard);
        assertEq(token.balanceOf(address(attacker)), 0);
        assertEq(v.idle(), 100_000 * UNIT);

        uint256 id = _pay(v, 10_000 * UNIT, 1);
        uint256 owed = v.owedOf(id);
        token.mint(platform, owed);
        vm.prank(platform);
        token.approve(address(v), type(uint256).max);
        attacker.configure(address(v), address(0), platform, id, bytes32(0));
        token.arm(address(attacker));
        vm.prank(platform);
        v.repay(id);
        assertEq(v.owedOf(id), 0);
        assertEq(v.advanceCount(), 1);
        _guarded(attacker, guard);

        token.mint(platform, 1_000 * UNIT);
        vm.prank(platform);
        token.approve(address(v), type(uint256).max);
        token.arm(address(attacker));
        vm.prank(platform);
        v.postReserve(platform, 1_000 * UNIT);
        assertEq(v.reserveOf(platform), 1_000 * UNIT);
        assertFalse(attacker.posted());
        assertEq(bytes32(attacker.postSel()), bytes32(guard));
        assertEq(token.balanceOf(address(v)), v.idle() + v.reserveOf(platform));
    }

    function test_relayRepayRejectsFeeYankAndReentrantRouter() public {
        (PartnerVault v, WeirdUSDG token) = _weird();
        PartnerRouter router = new PartnerRouter();
        vm.startPrank(partner);
        v.setRouter(address(router));
        router.register(address(v));
        vm.stopPrank();
        _give(v, token, partner, 100_000 * UNIT);
        uint256 id = _pay(v, 10_000 * UNIT, 1);
        bytes32 exitRef = keccak256(abi.encode("exit", uint256(1)));
        uint256 owed = v.owedOf(id);

        token.setKind(1);
        token.mint(platform, owed);
        vm.startPrank(platform);
        token.approve(address(router), type(uint256).max);
        vm.expectRevert(PartnerRouter.BalanceMismatch.selector);
        router.relayRepay(exitRef, 0);
        vm.stopPrank();
        assertEq(v.owedOf(id), owed);
        assertEq(token.balanceOf(address(router)), 0);

        token.setKind(0);
        token.setYank(true);
        vm.prank(platform);
        vm.expectRevert(PartnerRouter.BalanceMismatch.selector);
        router.relayRepay(exitRef, 0);
        assertEq(v.owedOf(id), owed);
        assertEq(token.balanceOf(address(router)), 0);
        token.setYank(false);

        TokenAttacker attacker = new TokenAttacker();
        attacker.configure(address(v), address(router), platform, id, exitRef);
        token.arm(address(attacker));
        vm.prank(platform);
        router.relayRepay(exitRef, 0);
        assertEq(v.owedOf(id), 0);
        assertEq(v.advanceCount(), 1);
        assertFalse(attacker.relayed());
        assertFalse(attacker.withdrew());
        assertEq(bytes32(attacker.relaySel()), bytes32(ReentrancyGuard.ReentrancyGuardReentrantCall.selector));
        assertEq(bytes32(attacker.withdrawSel()), bytes32(PartnerVaultAdmin.Unauthorized.selector));
        assertEq(token.balanceOf(address(router)), 0);
        assertEq(token.balanceOf(address(attacker)), 0);
        assertEq(token.balanceOf(address(v)), v.idle() + v.reserveOf(platform));
    }
    function _guarded(TokenAttacker attacker, bytes4 guard) internal view {
        assertFalse(attacker.withdrew() || attacker.repaid() || attacker.executed() || attacker.posted());
        assertEq(bytes32(attacker.withdrawSel()), bytes32(guard));
        assertEq(bytes32(attacker.repaySel()), bytes32(guard));
        assertEq(bytes32(attacker.executeSel()), bytes32(guard));
        assertEq(bytes32(attacker.postSel()), bytes32(guard));
    }
    function _weird() internal returns (PartnerVault v, WeirdUSDG token) {
        token = new WeirdUSDG();
        bytes memory initData = abi.encodeCall(PartnerVaultAdmin.initialize, (partner, address(token), 1 days, 1 days));
        v = PartnerVault(address(new ERC1967Proxy(address(new PartnerVault()), initData)));
        vm.startPrank(partner);
        v.setProposer(engine);
        v.setMandate(100, 30 days, 10_000, uint64(block.timestamp + 365 days));
        v.setPlatform(platform, true, 10_000_000 * UNIT, 0, false, 1 days);
        vm.stopPrank();
    }
    function _give(PartnerVault v, WeirdUSDG token, address who, uint256 amount) internal {
        token.mint(who, amount);
        vm.startPrank(who);
        token.approve(address(v), type(uint256).max);
        if (who == partner) v.deposit(amount);
        else v.postReserve(platform, amount);
        vm.stopPrank();
    }

    function _pay(PartnerVault v, uint256 nav, uint256 nonce) internal returns (uint256 id) {
        AdvanceProposal memory p = _proposal(nav, nonce);
        bytes memory sig = _engineSig(v, p);
        vm.prank(partner);
        id = v.execute(p, sig, "");
    }
}
