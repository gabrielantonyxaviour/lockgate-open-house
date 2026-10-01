// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {MockUSDG} from "../../src/core/MockUSDG.sol";
import {UsdgAdapter} from "../../src/core/UsdgAdapter.sol";
import {PricingEngine} from "../../src/core/PricingEngine.sol";
import {PlatformReserve} from "../../src/core/PlatformReserve.sol";
import {LockgateCreditLine} from "../../src/core/LockgateCreditLine.sol";
import {FundFactory} from "../../src/core/FundFactory.sol";

/// @notice Registered draw caller. Lockgate treats `msg.sender` as the platform.
contract StubSource {
    uint256 public nav = 1e6;
    uint64 public navUpdatedAt;
    bool public gated;
    uint64 public nextWindow;
    LockgateCreditLine public immutable line;

    constructor(address line_) {
        line = LockgateCreditLine(line_);
        navUpdatedAt = uint64(block.timestamp);
        nextWindow = uint64(block.timestamp) + 600;
        IERC20(line.token()).approve(line_, type(uint256).max);
    }

    function setNavTime(uint64 at) external {
        navUpdatedAt = at;
    }

    function setGated(bool next) external {
        gated = next;
    }

    function setWindow(uint64 at) external {
        nextWindow = at;
    }

    function poke() external {
        navUpdatedAt = uint64(block.timestamp);
        nextWindow = uint64(block.timestamp) + 600;
    }

    function draw(uint256 navValue, address to, uint256 maxFee) external returns (uint256 id, uint256 fee) {
        return line.draw(navValue, to, maxFee);
    }
}

contract CoreFixture is Test {
    address internal owner;
    address internal issuer;
    address internal investor;
    address internal stranger;

    MockUSDG internal usdg;
    UsdgAdapter internal adapter;
    PricingEngine internal pricing;
    PlatformReserve internal reserve;
    LockgateCreditLine internal line;
    FundFactory internal factory;

    function _core() internal {
        owner = makeAddr("owner");
        issuer = makeAddr("issuer");
        investor = makeAddr("investor");
        stranger = makeAddr("stranger");
        usdg = new MockUSDG(owner);
        adapter = new UsdgAdapter(address(usdg), true);
        pricing = new PricingEngine(owner);
        reserve = new PlatformReserve(owner, address(adapter));
        line = new LockgateCreditLine(owner, address(adapter), address(pricing), address(reserve));
        vm.startPrank(owner);
        reserve.setCreditLine(address(line));
        reserve.setSlasher(address(line), true);
        usdg.mint(owner, 1_000_000e6);
        usdg.approve(address(line), type(uint256).max);
        line.depositCapital(500_000e6);
        factory = new FundFactory(owner, address(adapter), address(line), address(reserve));
        line.setRegistrar(address(factory), true);
        usdg.setMinter(address(factory), true);
        vm.stopPrank();
    }

    function _stub(uint256 limit, uint16 reserveBps) internal returns (StubSource stub) {
        stub = new StubSource(address(line));
        vm.prank(owner);
        line.registerSource(address(stub), limit, reserveBps);
    }

    function _mint(address to, uint256 amount) internal {
        vm.prank(owner);
        usdg.mint(to, amount);
    }

    function _post(address source, uint256 amount) internal {
        _mint(issuer, amount);
        vm.startPrank(issuer);
        usdg.approve(address(reserve), amount);
        reserve.post(source, amount);
        vm.stopPrank();
    }
}
