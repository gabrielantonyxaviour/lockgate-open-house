// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {AdvanceProposal} from "../../src/interfaces/IAdvanceProposal.sol";
import {PartnerRouter} from "../../src/partner/PartnerRouter.sol";
import {PartnerVault} from "../../src/partner/PartnerVault.sol";
import {PartnerVaultAdmin} from "../../src/partner/PartnerVaultAdmin.sol";
import {Advance, AdvanceStatus, RejectReason} from "../../src/partner/Types.sol";
import {FeeMath} from "../../src/partner/libraries/FeeMath.sol";
import {CoreStack} from "./CoreStack.sol";

/// @notice FIFO redemption queue. It forwards a partner-vault payout to the seller, then repays
///         that advance in full. It does not mint shares and it does not keep a balance.
contract MockPlatformQueue {
    using SafeERC20 for IERC20;

    enum Status { Queued, Advanced, Repaid }

    struct Request {
        address owner;
        uint256 nav;
        uint256 advanceId;
        Status status;
    }

    IERC20 public immutable token;
    PartnerVault public immutable vault;

    Request[] internal _requests;
    uint256 public head;

    error NotHead();
    error BadStatus();
    error ShortCash();

    constructor(IERC20 token_, PartnerVault vault_) {
        token = token_;
        vault = vault_;
    }

    function enqueue(address owner, uint256 nav) external returns (uint256 id) {
        _requests.push(Request(owner, nav, 0, Status.Queued));
        return _requests.length;
    }

    function statusOf(uint256 id) external view returns (uint8) {
        return uint8(_requests[id - 1].status);
    }

    function advanceOf(uint256 id) external view returns (uint256) {
        return _requests[id - 1].advanceId;
    }

    /// @notice Pay the oldest queued request from the payout this contract just received.
    function settle(uint256 id, uint256 advanceId) external {
        if (id != head + 1) revert NotHead();
        Request storage request = _requests[id - 1];
        if (request.status != Status.Queued) revert BadStatus();
        Advance memory funded = vault.getAdvance(advanceId);
        if (
            funded.navValue != request.nav || funded.recipient != address(this)
                || funded.status != AdvanceStatus.Active
        ) revert BadStatus();
        uint256 payout = funded.principal;
        if (token.balanceOf(address(this)) < payout) revert ShortCash();
        request.advanceId = advanceId;
        request.status = Status.Advanced;
        head = id;
        token.safeTransfer(request.owner, payout);
    }

    function fund(uint256 amount) external {
        token.safeTransferFrom(msg.sender, address(this), amount);
    }

    /// @notice Repay the advance at `head`. The balance must equal `owed`, and it must end at zero.
    function repay(uint256 id, PartnerRouter router, bytes32 quoteId) external {
        if (id != head) revert NotHead();
        Request storage request = _requests[id - 1];
        if (request.status != Status.Advanced) revert BadStatus();
        uint256 owed = vault.owedOf(request.advanceId);
        if (token.balanceOf(address(this)) != owed) revert ShortCash();
        token.forceApprove(address(router), owed);
        router.relayRepay(quoteId, 0);
        token.forceApprove(address(router), 0);
        if (token.balanceOf(address(this)) != 0) revert ShortCash();
        request.status = Status.Repaid;
    }
}

/// @notice Stage-1 line quote, partner vault, and the mock queue, from request through repayment.
contract PartnerQueueTest is CoreStack {
    uint256 internal constant ENGINE_PK = 0xA11CE;
    uint256 internal constant ROUND_NAV = 10_000 * UNIT;

    PartnerVault internal vault;
    PartnerRouter internal router;
    MockPlatformQueue internal queue;
    address internal partner;
    address internal engine;
    address internal alice;
    address internal bob;
    uint256 internal lineCash;

    function setUp() public {
        _core(500);
        _armSource(500 * UNIT);
        engine = vm.addr(ENGINE_PK);
        partner = vm.addr(0xB0B);
        alice = makeAddr("alice");
        bob = makeAddr("bob");
        vault = _vault(partner);
        queue = new MockPlatformQueue(token, vault);
        router = new PartnerRouter();
        vm.startPrank(partner);
        vault.setProposer(engine);
        vault.setMandate(100, 30 days, 10_000, uint64(block.timestamp + 365 days));
        vault.setPlatform(address(queue), true, 10_000_000 * UNIT, 500, false, 1 days);
        vault.setRouter(address(router));
        router.register(address(vault));
        vm.stopPrank();
        _fundVault(vault, partner, 40_000 * UNIT);
        token.mint(address(this), 1_000 * UNIT);
        token.approve(address(vault), 1_000 * UNIT);
        vault.postReserve(address(queue), 1_000 * UNIT);
        lineCash = line.capital();
    }

    function test_queueFundsAndRepaysAcrossFeeSettings() public {
        (uint256 quoted, uint16 bps, bool available, string memory reason) = line.quote(address(source), ROUND_NAV);
        assertTrue(available, reason);
        assertEq(bps, 99);
        assertEq(quoted, Math.mulDiv(ROUND_NAV, 99, 10_000, Math.Rounding.Ceil));
        assertLt(quoted, FeeMath.minFee(ROUND_NAV, 100));

        uint256 fees;
        uint256 id = queue.enqueue(alice, ROUND_NAV);
        _reject(ROUND_NAV, quoted, 99, 1);
        _reject(ROUND_NAV, FeeMath.minFee(ROUND_NAV, 100) - 1, 100, 2);
        assertEq(queue.statusOf(id), 0);
        fees += _cycle(id, alice, ROUND_NAV, FeeMath.minFee(ROUND_NAV, 100), 100, 3);

        uint256 odd = ROUND_NAV + 50;
        uint256 floorOdd = FeeMath.minFee(odd, 100);
        uint256 half = FeeMath.mulDivHalfUp(odd, 100, 10_000);
        assertEq(half, floorOdd + 1);
        uint256 oddId = queue.enqueue(alice, odd);
        _reject(odd, floorOdd - 1, 100, 4);
        assertEq(queue.statusOf(oddId), 0);
        fees += _cycle(oddId, alice, odd, half, 100, 5);
        fees += _cycle(queue.enqueue(bob, odd), bob, odd, FeeMath.minFee(odd, 250), 250, 6);

        uint256 later = queue.enqueue(alice, ROUND_NAV);
        uint256 skipped = queue.enqueue(bob, ROUND_NAV);
        uint256 early = _execute(ROUND_NAV, FeeMath.minFee(ROUND_NAV, 100), 100, 7);
        uint256 bobAt = token.balanceOf(bob);
        vm.expectRevert(MockPlatformQueue.NotHead.selector);
        queue.settle(skipped, early);
        assertEq(token.balanceOf(bob), bobAt);
        assertEq(queue.statusOf(skipped), 0);
        queue.settle(later, early);
        _repay(later, 7);
        fees += FeeMath.minFee(ROUND_NAV, 100);
        fees += _cycle(skipped, bob, ROUND_NAV, FeeMath.minFee(ROUND_NAV, 150), 150, 8);

        assertEq(vault.outstandingPrincipal(), 0);
        assertEq(vault.exposureOf(address(queue)), 0);
        assertEq(vault.idle(), 40_000 * UNIT + fees);
        assertEq(token.balanceOf(address(vault)), vault.idle() + vault.reserveCash());
        assertEq(vault.reserveOf(address(queue)), 1_000 * UNIT);
        assertEq(token.balanceOf(address(queue)), 0);
        assertEq(token.balanceOf(address(router)), 0);
        assertEq(token.balanceOf(investor), 0);
        assertEq(line.capital(), lineCash);
        assertEq(line.eligibleOutstanding(), 0);
        assertEq(token.balanceOf(address(line)), lineCash);
        assertEq(
            token.balanceOf(alice) + token.balanceOf(bob) + vault.idle() + vault.reserveCash(),
            40_000 * UNIT + 1_000 * UNIT + _navs()
        );
    }

    function _reject(uint256 nav, uint256 fee, uint16 bps, uint256 nonce) internal {
        AdvanceProposal memory p = _proposal(nav, fee, bps, nonce);
        bytes memory sig = _sign(p);
        assertEq(uint256(vault.preview(p)), uint256(RejectReason.Fee));
        uint256 idle = vault.idle();
        uint256 held = token.balanceOf(address(queue));
        vm.prank(partner);
        vm.expectRevert(abi.encodeWithSelector(PartnerVaultAdmin.MandateRejected.selector, RejectReason.Fee));
        vault.execute(p, sig, "");
        assertEq(vault.idle(), idle);
        assertEq(token.balanceOf(address(queue)), held);
        assertEq(line.capital(), lineCash);
        assertEq(line.eligibleOutstanding(), 0);
    }

    function _cycle(uint256 id, address seller, uint256 nav, uint256 fee, uint16 bps, uint256 nonce)
        internal
        returns (uint256)
    {
        uint256 advanceId = _execute(nav, fee, bps, nonce);
        uint256 before = token.balanceOf(seller);
        queue.settle(id, advanceId);
        assertEq(token.balanceOf(seller), before + nav - fee);
        assertEq(token.balanceOf(address(queue)), 0);
        assertEq(vault.outstandingPrincipal(), nav - fee);
        _repay(id, nonce);
        assertEq(vault.owedOf(advanceId), 0);
        assertEq(line.eligibleOutstanding(), 0);
        return fee;
    }

    function _execute(uint256 nav, uint256 fee, uint16 bps, uint256 nonce) internal returns (uint256 advanceId) {
        AdvanceProposal memory p = _proposal(nav, fee, bps, nonce);
        bytes memory sig = _sign(p);
        vm.prank(partner);
        advanceId = vault.execute(p, sig, "");
        assertEq(vault.owedOf(advanceId), nav);
        assertEq(token.balanceOf(address(queue)), nav - fee);
    }

    function _repay(uint256 id, uint256 nonce) internal {
        uint256 owed = vault.owedOf(queue.advanceOf(id));
        token.mint(address(this), owed);
        token.approve(address(queue), owed);
        queue.fund(owed);
        queue.repay(id, router, bytes32(nonce));
        assertEq(token.balanceOf(address(queue)), 0);
        assertEq(token.balanceOf(address(router)), 0);
    }

    function _navs() internal pure returns (uint256) {
        return ROUND_NAV * 3 + (ROUND_NAV + 50) * 2;
    }

    function _proposal(uint256 nav, uint256 fee, uint16 bps, uint256 nonce)
        internal
        view
        returns (AdvanceProposal memory p)
    {
        uint64 dueAt = uint64(block.timestamp + 7 days);
        p = AdvanceProposal({
            platform: address(queue),
            recipient: address(queue),
            requestId: nonce,
            navValue: nav,
            fee: fee,
            payout: nav - fee,
            feeBps: bps,
            dueAt: dueAt,
            expiresAt: uint64(block.timestamp + 1 hours),
            nonce: nonce,
            quoteId: bytes32(nonce)
        });
    }

    function _sign(AdvanceProposal memory p) internal view returns (bytes memory) {
        bytes32 digest = vault.hashTypedProposal(p);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(ENGINE_PK, digest);
        return abi.encodePacked(r, s, v);
    }
}
