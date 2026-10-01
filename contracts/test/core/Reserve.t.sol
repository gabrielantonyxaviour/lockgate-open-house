// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {CoreFixture, StubSource} from "./Support.sol";
import {PlatformReserve} from "../../src/core/PlatformReserve.sol";
import {UsdgAdapter} from "../../src/core/UsdgAdapter.sol";
import {UsdgTransfers} from "../../src/core/UsdgTransfers.sol";

contract SkimToken is ERC20 {
    constructor() ERC20("skim", "SKIM") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function transferFrom(address from, address to, uint256 amount) public override returns (bool) {
        _spendAllowance(from, msg.sender, amount);
        _transfer(from, to, amount - amount / 10);
        return true;
    }
}

contract ReserveTest is CoreFixture {
    StubSource internal stub;

    function setUp() public {
        _core();
        stub = _stub(1_000_000e6, 750);
        vm.prank(address(stub));
        reserve.setAdmin(address(stub), issuer);
        _post(address(stub), 10e6);
    }

    function test_postWithdrawFloorAndSlashTarget() public {
        assertEq(reserve.balanceOf(address(stub)), 10e6);
        assertEq(reserve.totalBalances(), 10e6);
        assertEq(reserve.tokenBalance(), 10e6);

        vm.prank(owner);
        vm.expectRevert(PlatformReserve.NotAdmin.selector);
        reserve.withdraw(address(stub), 1);

        vm.prank(issuer);
        reserve.withdraw(address(stub), 1e6);
        assertEq(reserve.balanceOf(address(stub)), 9e6);
        assertEq(usdg.balanceOf(issuer), 1e6);

        vm.prank(address(line));
        uint256 slashed = reserve.slash(address(stub), 4e6);
        assertEq(slashed, 4e6);
        assertEq(usdg.balanceOf(address(line)), 500_000e6 + 4e6);
        assertEq(reserve.balanceOf(address(stub)), 5e6);

        vm.prank(stranger);
        vm.expectRevert(PlatformReserve.NotSlasher.selector);
        reserve.slash(address(stub), 1);
    }

    function test_requiredFloorBlocksWithdraw() public {
        (uint256 id,) = stub.draw(100e6, investor, type(uint256).max);
        assertEq(id, 1);
        assertEq(line.requiredReserve(address(stub)), 7_500_000);
        vm.prank(issuer);
        vm.expectRevert(abi.encodeWithSelector(PlatformReserve.ShortReserve.selector, 7_499_999, 7_500_000));
        reserve.withdraw(address(stub), 10e6 - 7_499_999);
        vm.prank(issuer);
        reserve.withdraw(address(stub), 10e6 - 7_500_000);
        assertEq(reserve.balanceOf(address(stub)), 7_500_000);
    }

    function test_lockSlashersAndCreditLineOnce() public {
        vm.prank(owner);
        reserve.lockSlasherSet();
        vm.prank(owner);
        vm.expectRevert(PlatformReserve.SlashersLocked.selector);
        reserve.setSlasher(stranger, true);
        vm.prank(owner);
        vm.expectRevert(PlatformReserve.AlreadySet.selector);
        reserve.setCreditLine(address(line));
    }

    function test_postReservePassesThroughCreditLine() public {
        uint256 beforeBal = usdg.balanceOf(address(line));
        _mint(investor, 5e6);
        vm.startPrank(investor);
        usdg.approve(address(line), 5e6);
        line.postReserve(address(stub), 5e6);
        vm.stopPrank();
        assertEq(reserve.balanceOf(address(stub)), 15e6);
        assertEq(usdg.balanceOf(address(line)), beforeBal);
        assertEq(line.accountedAssets(), line.accountedEquity());
    }

    function test_feeOnTransferCannotFundReserve() public {
        SkimToken skim = new SkimToken();
        UsdgAdapter skimAdapter = new UsdgAdapter(address(skim), true);
        PlatformReserve skimReserve = new PlatformReserve(owner, address(skimAdapter));
        skim.mint(issuer, 10e6);
        vm.startPrank(issuer);
        skim.approve(address(skimReserve), 10e6);
        vm.expectRevert(abi.encodeWithSelector(UsdgTransfers.FeeOnTransfer.selector, 10e6, 9e6));
        skimReserve.post(address(stub), 10e6);
        vm.stopPrank();
    }

    function test_zeroSlashStillReports() public {
        vm.prank(address(line));
        uint256 slashed = reserve.slash(address(stub), 0);
        assertEq(slashed, 0);
        assertEq(reserve.balanceOf(address(stub)), 10e6);
    }

    function test_onlyPlatformNamesAdmin() public {
        vm.prank(stranger);
        vm.expectRevert(PlatformReserve.NotPlatform.selector);
        reserve.setAdmin(address(stub), stranger);
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger));
        reserve.setSlasher(stranger, false);
        vm.prank(owner);
        vm.expectRevert(PlatformReserve.ZeroAddress.selector);
        reserve.setSlasher(address(0), true);
    }
}
