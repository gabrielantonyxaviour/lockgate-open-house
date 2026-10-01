// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {MockUSDG} from "../../src/core/MockUSDG.sol";
import {UsdgAdapter} from "../../src/core/UsdgAdapter.sol";
import {PricingEngine} from "../../src/core/PricingEngine.sol";
import {PlatformReserve} from "../../src/core/PlatformReserve.sol";
import {ILockgateCreditLine} from "../../src/interfaces/ILockgateCreditLine.sol";
import {LockgateCreditLine} from "../../src/core/LockgateCreditLine.sol";
import {CreditActor} from "./mocks/CreditActor.sol";

/// @notice Fuzzer entry for the stage-1 book. Successful calls update ghosts. Reverts are swallowed.
contract Stage1Handler is Test {
    uint256 internal constant U = 1e6;

    MockUSDG public token;
    PlatformReserve public reserve;
    LockgateCreditLine public line;
    CreditActor public alpha;
    CreditActor public beta;
    address public investorA;
    address public investorB;
    uint256 public paidA;
    uint256 public paidB;
    uint256 public failures;

    constructor() {
        token = new MockUSDG(address(this));
        UsdgAdapter adapter = new UsdgAdapter(address(token), true);
        PricingEngine pricing = new PricingEngine(address(this));
        reserve = new PlatformReserve(address(this), address(adapter));
        line = new LockgateCreditLine(address(this), address(adapter), address(pricing), address(reserve));
        reserve.setCreditLine(address(line));
        reserve.setSlasher(address(line), true);

        investorA = makeAddr("investorA");
        investorB = makeAddr("investorB");
        alpha = new CreditActor(line, token, investorA);
        beta = new CreditActor(line, token, investorB);
        line.registerSource(address(alpha), 1_000_000 * U, 750);
        line.registerSource(address(beta), 1_000_000 * U, 750);

        token.mint(address(this), 1_000_000 * U);
        token.approve(address(line), type(uint256).max);
        line.depositCapital(1_000_000 * U);
        token.mint(address(alpha), 80_000 * U);
        token.mint(address(beta), 80_000 * U);
        alpha.postReserve(80_000 * U);
        beta.postReserve(80_000 * U);
    }

    function draw(uint256 navSeed, uint8 which, uint64 windowIn) external {
        CreditActor actor = which % 2 == 0 ? alpha : beta;
        uint256 navValue = bound(navSeed, 1_000 * U, 12_000 * U);
        actor.refresh(uint64(bound(windowIn, 120, 800)));
        uint256 beforeBal = token.balanceOf(actor.investor());
        try actor.draw(navValue) returns (uint256, uint256 fee) {
            uint256 principal = navValue - fee;
            if (token.balanceOf(actor.investor()) != beforeBal + principal) failures += 1;
            if (actor == alpha) paidA += principal;
            else paidB += principal;
        } catch {}
    }

    function repay(uint256 idSeed) external {
        uint256 n = line.advanceCount();
        if (n == 0) return;
        uint256 id = bound(idSeed, 1, n);
        uint256 remaining = line.remainingOf(id);
        if (remaining == 0) return;
        CreditActor actor = CreditActor(line.getAdvance(id).source);
        address investor = actor.investor();
        uint256 investorBefore = token.balanceOf(investor);
        token.mint(address(actor), remaining);
        try actor.repay(id) {
            if (token.balanceOf(investor) != investorBefore) failures += 1;
        } catch {}
    }

    function markLate(uint256 idSeed) external {
        uint256 n = line.advanceCount();
        if (n == 0) return;
        uint256 id = bound(idSeed, 1, n);
        if (line.getAdvance(id).status != ILockgateCreditLine.AdvanceStatus.Active) return;
        uint64 due = line.getAdvance(id).dueAt;
        vm.warp(uint256(due) + line.grace());
        try line.markLate(id) {} catch {}
    }

    function drawWhileGated(uint256 navSeed) external {
        uint256 beforeCount = line.advanceCount();
        alpha.setGated(true);
        try alpha.draw(bound(navSeed, 1_000 * U, 5_000 * U)) {
            if (line.advanceCount() != beforeCount) failures += 1;
        } catch {}
        alpha.setGated(false);
    }

    function drawOnStaleNav(uint256 navSeed) external {
        if (block.timestamp < 8 days) vm.warp(8 days + 1);
        uint256 beforeCount = line.advanceCount();
        alpha.setNavUpdatedAt(uint64(block.timestamp - 8 days));
        try alpha.draw(bound(navSeed, 1_000 * U, 5_000 * U)) {
            if (line.advanceCount() != beforeCount) failures += 1;
        } catch {}
        alpha.refresh(600);
    }
}
