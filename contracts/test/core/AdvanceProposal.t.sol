// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {AdvanceProposal} from "../../src/interfaces/IAdvanceProposal.sol";
import {AdvanceProposalLib} from "../../src/interfaces/AdvanceProposalLib.sol";

/// @notice Golden values come from `cast keccak` / `cast abi-encode`, not from this library.
contract AdvanceProposalTest is Test {
    function test_typehashAndDigestMatchCast() public pure {
        assertEq(
            AdvanceProposalLib.TYPEHASH,
            0x3d4c04027a5de1daf68e94ce818379ff9b954f2c6c58199d9a682f5425db653a
        );
        bytes32 quote = AdvanceProposalLib.quoteId(
            address(0x2222222222222222222222222222222222222222),
            100_000_000,
            990_000,
            1_700_000_000,
            0,
            0,
            1_699_999_400,
            3
        );
        assertEq(quote, 0xd5f4bb7c255a5112bf5b8badd91b35d687f1616b93b65a4899c24860b1835dbc);
        AdvanceProposal memory proposal = AdvanceProposal({
            platform: address(0x2222222222222222222222222222222222222222),
            recipient: address(0x3333333333333333333333333333333333333333),
            requestId: 7,
            navValue: 100_000_000,
            fee: 990_000,
            payout: 99_010_000,
            feeBps: 99,
            dueAt: 1_700_000_000,
            expiresAt: 1_700_000_600,
            nonce: 1,
            quoteId: quote
        });
        assertEq(
            AdvanceProposalLib.domainSeparator(31337, address(0x1111111111111111111111111111111111111111)),
            0xc9c5e55f086d7297717adf1bddb6cb3712c2df485722a3d41448e240ba438620
        );
        assertEq(
            AdvanceProposalLib.digest(proposal, 31337, address(0x1111111111111111111111111111111111111111)),
            0x6d657d07e043d1f0e13c4963a6d8ba04214c39400fb6442e0415fafe35043fca
        );
    }
}
