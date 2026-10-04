// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {SignatureChecker} from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {DemoRegistry} from "./DemoRegistry.sol";
import {DemoFirmVault} from "./DemoFirmVault.sol";
import {DemoQuote} from "./DemoTypes.sol";

/// @notice Atomic TEST rights/payment ledger. A = acquired units; B = discharge + originator debt.
contract DemoSettlement is EIP712, ReentrancyGuard {
    error Denied();
    error Invalid();
    DemoRegistry public immutable registry;
    bytes32 public constant QUOTE_TYPEHASH = keccak256(
        "Quote(bytes32 holdingId,address vault,address investor,bytes32 identity,uint256 units,uint256 payout,uint256 repayment,uint8 route,uint64 deadline,uint64 maturity,uint256 nonce,bytes32 agreementHash)"
    );
    struct Deal { DemoQuote quote; address originator; uint256 paid; uint8 status; bool impaired; }
    mapping(bytes32 => Deal) private deals;
    mapping(address => mapping(uint256 => bool)) public nonceUsed;
    mapping(bytes32 => mapping(address => uint256)) public purchasedUnits;
    mapping(bytes32 => uint256) public dischargedUnits;
    mapping(bytes32 => mapping(address => uint256)) public collectedUnits;
    event Reserved(bytes32 indexed digest, bytes32 indexed holding, address indexed vault, uint256 payout, uint64 deadline);
    event Settled(bytes32 indexed digest, address indexed investor, uint8 route, uint256 units, uint256 payout, uint256 repayment);
    event Cancelled(bytes32 indexed digest);
    event Repaid(bytes32 indexed digest, address indexed payer, uint256 amount, uint256 remaining);
    event Impaired(bytes32 indexed digest);

    constructor(DemoRegistry registry_) EIP712("LockgateTestSettlement", "1") {
        if (block.chainid != 421614 || address(registry_).code.length == 0) revert Invalid();
        registry = registry_;
    }
    function quoteDigest(DemoQuote calldata q) public view returns (bytes32) {
        return _hashTypedDataV4(keccak256(abi.encode(QUOTE_TYPEHASH, q)));
    }
    function deal(bytes32 digest) external view returns (Deal memory) { return deals[digest]; }
    function reserve(DemoQuote calldata q, bytes calldata originatorSignature) external nonReentrant returns (bytes32 digest) {
        if (!registry.approvedVault(q.vault) || q.investor == address(0) || q.payout == 0
            || q.repayment < q.payout || q.deadline <= block.timestamp || q.deadline > block.timestamp + 7 days
            || q.maturity <= q.deadline || q.maturity > block.timestamp + 365 days || q.agreementHash == 0
            || nonceUsed[q.investor][q.nonce] || !registry.matches(q.investor, q.identity)) revert Invalid();
        DemoFirmVault vault = DemoFirmVault(q.vault);
        if (msg.sender != vault.manager() || address(vault.registry()) != address(registry)
            || vault.settlement() != address(this)) revert Denied();
        DemoRegistry.Holding memory h = registry.holding(q.holdingId);
        if (!registry.isActive(h.originator, 1)) revert Denied();
        digest = quoteDigest(q);
        if (!SignatureChecker.isValidSignatureNow(h.originator, digest, originatorSignature)) revert Denied();
        nonceUsed[q.investor][q.nonce] = true;
        registry.lock(q.holdingId, q.identity, q.units, q.route);
        vault.reserve(digest, h.originator, q.payout, q.route);
        deals[digest] = Deal(q, h.originator, 0, 1, false);
        emit Reserved(digest, q.holdingId, q.vault, q.payout, q.deadline);
    }
    function settle(DemoQuote calldata q, bytes calldata investorSignature) external nonReentrant {
        bytes32 digest = quoteDigest(q);
        Deal storage d = deals[digest];
        if (d.status != 1 || q.deadline < block.timestamp || !registry.matches(q.investor, q.identity)) revert Invalid();
        if (!SignatureChecker.isValidSignatureNow(q.investor, digest, investorSignature)) revert Denied();
        d.status = 2;
        registry.consume(q.holdingId, q.units, q.route, q.vault);
        if (q.route == 1) purchasedUnits[q.holdingId][q.vault] += q.units;
        else dischargedUnits[q.holdingId] += q.units;
        DemoFirmVault(q.vault).pay(digest, q.investor, q.route);
        emit Settled(digest, q.investor, q.route, q.units, q.payout, q.repayment);
    }
    function cancel(bytes32 digest) external nonReentrant {
        Deal storage d = deals[digest];
        if (d.status != 1) revert Invalid();
        DemoQuote memory q = d.quote;
        if (msg.sender != q.investor && msg.sender != DemoFirmVault(q.vault).manager() && block.timestamp <= q.deadline) revert Denied();
        d.status = 4;
        registry.unlock(q.holdingId, q.units);
        DemoFirmVault(q.vault).release(digest);
        emit Cancelled(digest);
    }
    function repay(bytes32 digest, uint256 amount) external nonReentrant {
        Deal storage d = deals[digest];
        if (d.status != 2 || amount == 0 || amount > d.quote.repayment - d.paid) revert Invalid();
        uint256 beforePrincipal = Math.mulDiv(d.paid, d.quote.payout, d.quote.repayment);
        d.paid += amount;
        uint256 principal = Math.mulDiv(d.paid, d.quote.payout, d.quote.repayment) - beforePrincipal;
        if (d.paid == d.quote.repayment) {
            d.status = 3;
            if (d.quote.route == 1) {
                purchasedUnits[d.quote.holdingId][d.quote.vault] -= d.quote.units;
                collectedUnits[d.quote.holdingId][d.quote.vault] += d.quote.units;
            }
        }
        DemoFirmVault(d.quote.vault).receiveRepayment(digest, msg.sender, amount, principal);
        emit Repaid(digest, msg.sender, amount, d.quote.repayment - d.paid);
    }
    /// @notice Accounting impairment only: preserves outstanding collection rights and recovery beneficiaries.
    function impair(bytes32 digest) external nonReentrant {
        Deal storage d = deals[digest];
        if (d.status != 2 || d.impaired || block.timestamp <= d.quote.maturity
            || msg.sender != DemoFirmVault(d.quote.vault).manager()) revert Denied();
        d.impaired = true;
        DemoFirmVault(d.quote.vault).impair(digest, d.quote.repayment - d.paid);
        emit Impaired(digest);
    }
}
