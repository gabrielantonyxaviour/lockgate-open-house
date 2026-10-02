// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {Test} from "forge-std/Test.sol";
import {AdvanceProposal} from "../../src/interfaces/IAdvanceProposal.sol";
import {IPartnerRouter} from "../../src/partner/interfaces/IPartnerRouter.sol";
import {PartnerRouter} from "../../src/partner/PartnerRouter.sol";
import {PartnerVault} from "../../src/partner/PartnerVault.sol";
import {PartnerVaultAdmin} from "../../src/partner/PartnerVaultAdmin.sol";
import {Advance, AdvanceStatus} from "../../src/partner/Types.sol";
import {WeirdUSDG} from "./mocks/WeirdUSDG.sol";

bytes32 constant EXIT_REF = keccak256("calls-exit");

/// @notice `owner()` and `getAdvance` try to mutate the directory from inside the router's staticcall.
contract DirectoryHook {
    PartnerRouter public router;
    address public attacker;
    address public plant;
    uint8 public kind;
    bool public entered;

    function configure(PartnerRouter router_, address attacker_, address plant_, uint8 kind_) external {
        router = router_;
        attacker = attacker_;
        plant = plant_;
        kind = kind_;
    }

    function owner() external returns (address) {
        if (kind == 1 || kind == 2) {
            if (entered) return address(this);
            entered = true;
            if (kind == 1) router.register(address(this));
            else router.register(plant);
        }
        return attacker;
    }

    function getAdvance(uint256) external returns (Advance memory a) {
        if (kind == 3 && !entered) {
            entered = true;
            router.notifyFunded(EXIT_REF, 2, address(0xBEEF), 100, 1);
        }
        a.platform = address(0xBEEF);
        a.navValue = 100;
        a.fee = 1;
        a.status = AdvanceStatus.Active;
        a.exitRef = EXIT_REF;
    }
}

contract Plant {
    address public owner;

    constructor(address owner_) {
        owner = owner_;
    }
}

/// @notice Probe data that is not a clean ABI word. `mode` 1 is a huge preview, 2 is a long preview, 3 is a long `idle`.
contract OddVault {
    address public who;
    uint8 public mode;

    constructor(address owner_, uint8 mode_) {
        who = owner_;
        mode = mode_;
    }

    function owner() external view returns (uint256) {
        if (mode == 4) return type(uint256).max;
        return uint256(uint160(who));
    }

    function mandate() external pure returns (address, address, uint16, uint64, uint16, uint64) {
        return (address(0), address(0), 500, 30 days, 10_000, type(uint64).max);
    }

    function maxNav(address, uint16, uint64) external pure returns (uint256) {
        return 1_000_000e6;
    }

    function idle() external view returns (uint256) {
        if (mode == 3) {
            assembly {
                mstore(0, 1000000000000)
                mstore(32, 1)
                return(0, 64)
            }
        }
        return 1_000_000e6;
    }

    function preview(AdvanceProposal calldata) external view returns (uint256) {
        if (mode == 1) return type(uint256).max;
        if (mode == 2) {
            assembly {
                mstore(0, 0)
                mstore(32, 1)
                return(0, 64)
            }
        }
        return 0;
    }
}

contract PartnerCallsTest is Test {
    uint256 internal constant UNIT = 1e6;
    uint256 internal constant ENGINE_PK = 0xA11CE;

    function test_registerReentryCannotListTheVault() public {
        PartnerRouter router = new PartnerRouter();
        DirectoryHook hook = new DirectoryHook();
        hook.configure(router, address(this), address(0), 1);
        bytes memory ret = _call(address(router), abi.encodeCall(PartnerRouter.register, (address(hook))));
        assertEq(ret, abi.encodeWithSelector(PartnerRouter.NotOwner.selector));
        assertEq(router.vaultCount(), 0);
    }

    function test_dirtyOwnerWordRevertsNotOwner() public {
        PartnerRouter router = new PartnerRouter();
        OddVault odd = new OddVault(address(this), 4);
        vm.expectRevert(PartnerRouter.NotOwner.selector);
        router.register(address(odd));
        assertEq(router.vaultCount(), 0);
    }

    function test_removeReentryCannotPlantAVault() public {
        PartnerRouter router = new PartnerRouter();
        DirectoryHook hook = new DirectoryHook();
        Plant plant = new Plant(address(hook));
        hook.configure(router, address(this), address(plant), 0);
        router.register(address(hook));
        DirectoryHook sibling = new DirectoryHook();
        sibling.configure(router, address(this), address(0), 0);
        router.register(address(sibling));
        hook.configure(router, address(this), address(plant), 2);
        bytes memory ret = _call(address(router), abi.encodeCall(PartnerRouter.remove, (address(hook))));
        assertEq(ret, abi.encodeWithSelector(PartnerRouter.NotOwner.selector));
        assertEq(router.vaultCount(), 2);
        assertGt(router.indexPlusOne(address(hook)), 0);
        assertGt(router.indexPlusOne(address(sibling)), 0);
        assertEq(router.indexPlusOne(address(plant)), 0);
    }

    function test_notifyReentryCannotPushASecondRecord() public {
        PartnerRouter router = new PartnerRouter();
        DirectoryHook hook = new DirectoryHook();
        hook.configure(router, address(this), address(0), 0);
        router.register(address(hook));
        hook.configure(router, address(this), address(0), 3);
        vm.prank(address(hook));
        bytes memory ret = _call(
            address(router), abi.encodeCall(PartnerRouter.notifyFunded, (EXIT_REF, 1, address(0xBEEF), 100, 1))
        );
        assertEq(ret, abi.encodeWithSelector(PartnerRouter.Mismatch.selector));
        assertEq(router.recordsOf(EXIT_REF).length, 0);
    }

    function test_oddReturnsDoNotBlankTheQuote() public {
        (PartnerVault v,) = _open(100_000 * UNIT);
        PartnerRouter router = new PartnerRouter();
        vm.startPrank(v.owner());
        v.setRouter(address(router));
        router.register(address(v));
        vm.stopPrank();
        router.register(address(new OddVault(address(this), 1)));
        router.register(address(new OddVault(address(this), 2)));
        router.register(address(new OddVault(address(this), 3)));
        IPartnerRouter.ExitRequest memory request = IPartnerRouter.ExitRequest({
            platform: makeAddr("platform"),
            recipient: makeAddr("platform"),
            navValue: 100_000 * UNIT,
            feeBps: 100,
            dueAt: uint64(block.timestamp + 7 days),
            exitRef: keccak256("calls")
        });
        IPartnerRouter.Slice[] memory best = router.quote(request, IPartnerRouter.Strategy.BestFee);
        assertEq(best.length, 1);
        assertEq(best[0].vault, address(v));
        assertEq(best[0].navValue, 100_000 * UNIT);
        assertEq(best[0].feeBps, 100);
        assertEq(best[0].fee, 1_000 * UNIT);
        IPartnerRouter.Slice[] memory parts = router.quote(request, IPartnerRouter.Strategy.ProRata);
        assertEq(parts.length, 1);
        assertEq(parts[0].vault, address(v));
        assertEq(parts[0].navValue, 4_761_904_762);
        assertEq(parts[0].feeBps, 100);
        assertEq(parts[0].fee, 47_619_048);
    }

    function test_relayRepayClipUnderDonationRevertsBalanceMismatch() public {
        (PartnerVault v, WeirdUSDG token) = _open(100_000 * UNIT);
        PartnerRouter router = new PartnerRouter();
        address platform = makeAddr("platform");
        vm.startPrank(v.owner());
        v.setRouter(address(router));
        router.register(address(v));
        vm.stopPrank();
        uint256 id = _pay(v, 10_000 * UNIT, 1);
        bytes32 exitRef = keccak256(abi.encode("exit", uint256(1)));
        uint256 owed = v.owedOf(id);
        uint256 donation = 50 * UNIT;
        token.mint(address(router), donation);
        token.mint(platform, owed);
        token.setClip(donation + owed);
        uint256 platformBal = token.balanceOf(platform);
        vm.startPrank(platform);
        token.approve(address(router), type(uint256).max);
        vm.expectRevert(PartnerRouter.BalanceMismatch.selector);
        router.relayRepay(exitRef, 0);
        vm.stopPrank();
        assertEq(v.owedOf(id), owed);
        assertEq(uint256(v.getAdvance(id).status), uint256(AdvanceStatus.Active));
        assertEq(token.balanceOf(address(router)), donation);
        assertEq(token.balanceOf(platform), platformBal);
    }

    function _call(address router, bytes memory data) internal returns (bytes memory ret) {
        bool ok;
        (ok, ret) = router.call{gas: 4_000_000}(data);
        assertFalse(ok);
    }

    function _open(uint256 cash) internal returns (PartnerVault v, WeirdUSDG token) {
        address partner = vm.addr(0xB0B);
        address platform = makeAddr("platform");
        token = new WeirdUSDG();
        v = PartnerVault(
            address(
                new ERC1967Proxy(
                    address(new PartnerVault()),
                    abi.encodeCall(PartnerVaultAdmin.initialize, (partner, address(token), 1 days, 1 days))
                )
            )
        );
        vm.startPrank(partner);
        v.setProposer(vm.addr(ENGINE_PK));
        v.setMandate(100, 30 days, 10_000, uint64(block.timestamp + 365 days));
        v.setPlatform(platform, true, 10_000_000 * UNIT, 0, false, 1 days);
        vm.stopPrank();
        token.mint(partner, cash);
        vm.startPrank(partner);
        token.approve(address(v), type(uint256).max);
        v.deposit(cash);
        vm.stopPrank();
    }

    function _pay(PartnerVault v, uint256 nav, uint256 nonce) internal returns (uint256 id) {
        address platform = makeAddr("platform");
        uint256 fee = (nav * 100) / 10_000;
        AdvanceProposal memory p = AdvanceProposal({
            platform: platform,
            recipient: platform,
            requestId: nonce,
            navValue: nav,
            fee: fee,
            payout: nav - fee,
            feeBps: 100,
            dueAt: uint64(block.timestamp + 7 days),
            expiresAt: uint64(block.timestamp + 1 hours),
            nonce: nonce,
            quoteId: keccak256(abi.encode("exit", nonce))
        });
        bytes32 digest = v.hashTypedProposal(p);
        (uint8 vv, bytes32 r, bytes32 s) = vm.sign(ENGINE_PK, digest);
        vm.prank(v.owner());
        id = v.execute(p, abi.encodePacked(r, s, vv), "");
    }
}
