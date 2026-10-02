// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {CoreFixture, StubSource} from "./Support.sol";
import {ILockgateCreditLine} from "../../src/interfaces/ILockgateCreditLine.sol";
import {IPricingEngine} from "../../src/interfaces/IPricingEngine.sol";
import {CreditLineAdmin} from "../../src/core/CreditLineAdmin.sol";
import {LockgateCreditLine} from "../../src/core/LockgateCreditLine.sol";
import {UsdgAdapter} from "../../src/core/UsdgAdapter.sol";
import {PricingEngine} from "../../src/core/PricingEngine.sol";
import {PlatformReserve} from "../../src/core/PlatformReserve.sol";

contract CallbackUsdg is ERC20, Ownable {
    address public sink;
    bool public armed;

    constructor(address owner_) ERC20("callback", "CB") Ownable(owner_) {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
    }

    function arm(address sink_) external {
        sink = sink_;
        armed = true;
    }

    function transfer(address to, uint256 amount) public override returns (bool) {
        bool ok = super.transfer(to, amount);
        if (armed) {
            armed = false;
            ILockgateCreditLine(sink).draw(100e6, to, type(uint256).max);
        }
        return ok;
    }
}

contract CreditLineEdgesTest is CoreFixture {
    StubSource internal stub;

    function setUp() public {
        _core();
        stub = _stub(1_000_000e6, 750);
        _post(address(stub), 50e6);
    }

    function test_quoteAndDrawGuards() public {
        (,,, string memory why) = line.quote(stranger, 100e6);
        assertEq(why, "unregistered");
        (,,, why) = line.quote(address(stub), 0);
        assertEq(why, "zero");
        stub.setGated(true);
        vm.expectRevert(CreditLineAdmin.Gated.selector);
        stub.draw(100e6, investor, type(uint256).max);
        (,,, why) = line.quote(address(stub), 100e6);
        assertEq(why, "gated");
        stub.setGated(false);

        stub.setWindow(uint64(block.timestamp));
        vm.expectRevert(CreditLineAdmin.WindowDue.selector);
        stub.draw(100e6, investor, type(uint256).max);
        stub.setWindow(uint64(block.timestamp) + 600);

        uint256 opened = 30 days;
        vm.warp(opened);
        stub.poke();
        stub.setNavTime(uint64(opened + 1));
        vm.expectRevert(CreditLineAdmin.BadNavTime.selector);
        stub.draw(100e6, investor, type(uint256).max);
        stub.setNavTime(uint64(opened - 7 days - 1));
        vm.expectRevert(CreditLineAdmin.StaleNav.selector);
        stub.draw(100e6, investor, type(uint256).max);
        stub.setNavTime(uint64(opened));

        vm.expectRevert(abi.encodeWithSelector(CreditLineAdmin.FeeTooHigh.selector, 990_000, 989_999));
        stub.draw(100e6, investor, 989_999);
        vm.expectRevert(CreditLineAdmin.ZeroAddress.selector);
        stub.draw(100e6, address(0), type(uint256).max);
        vm.expectRevert(CreditLineAdmin.FeeConsumesValue.selector);
        stub.draw(1, investor, type(uint256).max);
    }

    function test_limitReserveUtilConcentrationAndCapital() public {
        vm.expectRevert(CreditLineAdmin.OverLimit.selector);
        stub.draw(1_000_000e6 + 1, investor, type(uint256).max);

        StubSource thin = _stub(1_000_000e6, 750);
        _post(address(thin), 750);
        vm.expectRevert(CreditLineAdmin.ReserveShort.selector);
        thin.draw(10_001, investor, type(uint256).max);
        _post(address(thin), 1);
        thin.draw(10_001, investor, type(uint256).max);
        assertEq(line.requiredReserve(address(thin)), 751);

        vm.prank(owner);
        line.setCaps(100, 10_000);
        vm.expectRevert(CreditLineAdmin.UtilizationCap.selector);
        stub.draw(6_000e6, investor, type(uint256).max);
        vm.prank(owner);
        line.setCaps(10_000, 5_000);
        vm.expectRevert(CreditLineAdmin.ConcentrationCap.selector);
        stub.draw(100e6, investor, type(uint256).max);

        vm.prank(owner);
        line.setCaps(10_000, 10_000);
        uint256 free = line.accountedEquity() - line.outstanding();
        vm.prank(owner);
        line.withdrawCapital(free);
        vm.expectRevert(CreditLineAdmin.CapitalShort.selector);
        stub.draw(100e6, investor, type(uint256).max);
    }

    function test_donationIsNotWithdrawableEquity() public {
        uint256 equity = line.accountedEquity();
        uint256 unpaid = line.outstanding();
        deal(address(usdg), address(line), usdg.balanceOf(address(line)) + 10e6);
        assertGt(line.accountedAssets(), equity);
        vm.prank(owner);
        vm.expectRevert(CreditLineAdmin.CapitalShort.selector);
        line.withdrawCapital(equity - unpaid + 1);
        assertEq(line.accountedEquity(), equity);
    }

    function test_drawReentrancyReverts() public {
        CallbackUsdg token = new CallbackUsdg(owner);
        UsdgAdapter tokenAdapter = new UsdgAdapter(address(token), true);
        PricingEngine books = new PricingEngine(owner);
        PlatformReserve box = new PlatformReserve(owner, address(tokenAdapter));
        LockgateCreditLine book = new LockgateCreditLine(owner, address(tokenAdapter), address(books), address(box));
        vm.startPrank(owner);
        box.setCreditLine(address(book));
        box.setSlasher(address(book), true);
        token.mint(owner, 1_000e6);
        token.approve(address(book), type(uint256).max);
        book.depositCapital(500e6);
        vm.stopPrank();
        StubSource source = new StubSource(address(book));
        vm.prank(owner);
        book.registerSource(address(source), 1_000_000e6, 0);
        token.arm(address(book));
        vm.expectRevert(ReentrancyGuard.ReentrancyGuardReentrantCall.selector);
        source.draw(100e6, investor, type(uint256).max);
        assertEq(book.advanceCount(), 0);
        assertEq(book.accountedAssets(), book.accountedEquity());
    }

    function test_requiredReserveRoundsUpFromOneUnit() public {
        IPricingEngine.Params memory p = pricing.params();
        p.minFeeBps = 0;
        p.timeScale = 1;
        vm.prank(owner);
        pricing.setParams(p);
        StubSource tiny = _stub(100, 750);
        tiny.setWindow(uint64(block.timestamp) + 1);
        vm.expectRevert(CreditLineAdmin.ReserveShort.selector);
        tiny.draw(1, investor, type(uint256).max);
        _post(address(tiny), 1);
        tiny.draw(1, investor, type(uint256).max);
        assertEq(line.requiredReserve(address(tiny)), 1);
    }

    /// @dev Outstanding 5000 and capital 5001. The view floors to 4999. The next principal of 1 ceils to 5001.
    function test_utilizationViewFloorsWhileTheNextUnitCeilsOver() public {
        _zeroMinFee();
        StubSource book = _stub(1_000_000e6, 0);
        (uint256 id, uint256 fee) = book.draw(5_000, investor, type(uint256).max);
        assertEq(fee, 0);
        assertEq(line.getAdvance(id).principal, 5_000);

        uint256 idle = line.capital() - 5_001;
        vm.prank(owner);
        line.withdrawCapital(idle);
        vm.prank(owner);
        line.setCaps(5_000, 10_000);

        assertEq(line.capital(), 5_001);
        assertEq(line.outstanding(), 5_000);
        assertEq(line.utilizationBps(), 4_999);

        (uint256 quoted, uint16 bps, bool available, string memory why) = line.quote(address(book), 1);
        assertEq(quoted, 0);
        assertEq(bps, 0);
        assertFalse(available);
        assertEq(why, "utilization");

        uint256 advances = line.advanceCount();
        vm.expectRevert(CreditLineAdmin.UtilizationCap.selector);
        book.draw(1, investor, type(uint256).max);
        assertEq(line.advanceCount(), advances);
        assertEq(line.capital(), 5_001);
        assertEq(line.outstanding(), 5_000);

        vm.prank(owner);
        line.setCaps(5_001, 10_000);
        (, uint256 nextFee) = book.draw(1, investor, type(uint256).max);
        assertEq(nextFee, 0);
        assertEq(line.outstanding(), 5_001);
        assertEq(line.capital(), 5_000);
        assertEq(line.utilizationBps(), 5_000);
        assertEq(usdg.balanceOf(investor), 5_001);
    }

    /// @dev Capital 0 and outstanding 5000. The view is 10000. The draw stops on capital before that cap.
    function test_zeroCapitalReportsFullUtilizationAndQuotesCapital() public {
        _zeroMinFee();
        StubSource book = _stub(1_000_000e6, 0);
        book.draw(5_000, investor, type(uint256).max);
        uint256 idle = line.capital();
        vm.prank(owner);
        line.withdrawCapital(idle);
        assertEq(line.capital(), 0);
        assertEq(line.outstanding(), 5_000);
        assertEq(line.utilizationBps(), 10_000);
        (,,, string memory why) = line.quote(address(book), 1);
        assertEq(why, "capital");
        uint256 advances = line.advanceCount();
        vm.expectRevert(CreditLineAdmin.CapitalShort.selector);
        book.draw(1, investor, type(uint256).max);
        assertEq(line.advanceCount(), advances);
        assertEq(line.utilizationBps(), 10_000);
    }

    function _zeroMinFee() internal {
        IPricingEngine.Params memory p = pricing.params();
        p.minFeeBps = 0;
        p.timeScale = 1;
        vm.prank(owner);
        pricing.setParams(p);
    }
}
