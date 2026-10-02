// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {ICreditSource} from "../../src/interfaces/ICreditSource.sol";
import {MockUSDG} from "../../src/core/MockUSDG.sol";
import {UsdgAdapter} from "../../src/core/UsdgAdapter.sol";
import {PricingEngine} from "../../src/core/PricingEngine.sol";
import {PlatformReserve} from "../../src/core/PlatformReserve.sol";
import {LockgateCreditLine} from "../../src/core/LockgateCreditLine.sol";
import {PartnerVault} from "../../src/partner/PartnerVault.sol";
import {PartnerVaultAdmin} from "../../src/partner/PartnerVaultAdmin.sol";

/// @notice Stage-1 platform. Draws and repayments come from this contract.
contract LineSource is ICreditSource {
    LockgateCreditLine public immutable line;
    IERC20 public immutable token;
    address public immutable investor;

    bool public gated;
    uint64 public navUpdatedAt;
    uint64 public nextWindow;
    uint256 public nav = 1e18;

    constructor(LockgateCreditLine line_, IERC20 token_, address investor_) {
        line = line_;
        token = token_;
        investor = investor_;
        navUpdatedAt = uint64(block.timestamp);
        nextWindow = uint64(block.timestamp + 600);
        token_.approve(address(line_), type(uint256).max);
    }

    function refresh() external {
        gated = false;
        navUpdatedAt = uint64(block.timestamp);
        nextWindow = uint64(block.timestamp + 600);
    }

    function fundReserve(uint256 amount) external {
        line.postReserve(address(this), amount);
    }

    function draw(uint256 navValue) external returns (uint256 id, uint256 fee) {
        return line.draw(navValue, investor, type(uint256).max);
    }

    function repay(uint256 id) external {
        line.repay(id);
    }
}

/// @notice Fresh stage-1 line and a partner vault on G6's MockUSDG. Each test deploys its own.
abstract contract CoreStack is Test {
    uint256 internal constant UNIT = 1e6;

    MockUSDG internal token;
    LockgateCreditLine internal line;
    LineSource internal source;
    address internal investor;

    function _core(uint16 reserveBps) internal {
        token = new MockUSDG(address(this));
        UsdgAdapter adapter = new UsdgAdapter(address(token), true);
        PricingEngine pricing = new PricingEngine(address(this));
        PlatformReserve reserve = new PlatformReserve(address(this), address(adapter));
        line = new LockgateCreditLine(address(this), address(adapter), address(pricing), address(reserve));
        reserve.setCreditLine(address(line));
        reserve.setSlasher(address(line), true);
        investor = makeAddr("investor");
        source = new LineSource(line, token, investor);
        line.registerSource(address(source), 1_000_000 * UNIT, reserveBps);
        token.mint(address(this), 200_000 * UNIT);
        token.approve(address(line), type(uint256).max);
        line.depositCapital(200_000 * UNIT);
    }

    function _armSource(uint256 reserveAmount) internal {
        token.mint(address(source), reserveAmount);
        source.fundReserve(reserveAmount);
        source.refresh();
    }

    function _vault(address owner_) internal returns (PartnerVault v) {
        PartnerVault impl = new PartnerVault();
        bytes memory initData = abi.encodeCall(PartnerVaultAdmin.initialize, (owner_, address(token), 1 days, 1 days));
        v = PartnerVault(address(new ERC1967Proxy(address(impl), initData)));
    }

    function _fundVault(PartnerVault vault_, address owner_, uint256 amount) internal {
        token.mint(owner_, amount);
        vm.startPrank(owner_);
        token.approve(address(vault_), amount);
        vault_.deposit(amount);
        vm.stopPrank();
    }
}
