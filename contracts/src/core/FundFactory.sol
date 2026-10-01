// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IFundFactory} from "../interfaces/IFundFactory.sol";
import {ILockgateCreditLine} from "../interfaces/ILockgateCreditLine.sol";
import {IPlatformReserve} from "../interfaces/IPlatformReserve.sol";
import {IUsdgAdapter} from "../interfaces/IUsdgAdapter.sol";
import {QueueKind} from "../interfaces/IQueueAdapter.sol";
import {IMockUSDG} from "../interfaces/IMockUSDG.sol";
import {PlatformConfig} from "./PlatformConfig.sol";
import {WeeklyCyclePlatform} from "./WeeklyCyclePlatform.sol";
import {EpochQueuePlatform} from "./EpochQueuePlatform.sol";
import {QuarterlyWindowPlatform} from "./QuarterlyWindowPlatform.sol";

/// @title FundFactory
/// @notice Sandbox platforms. `createDemoFund` seeds the MVP numbers and only works when the token is MockUSDG.
contract FundFactory is Ownable, IFundFactory {
    uint256 public constant DEMO_NAV = 1_023_400;
    uint256 public constant DEMO_SHARE_VALUE = 10_000e6;
    uint256 public constant DEMO_CASH = 2_000e6;
    uint256 public constant DEMO_LIMIT = 25_000e6;
    uint16 public constant DEMO_RESERVE_BPS = 750;
    uint256 public constant DEMO_RESERVE = 1_875e6;

    address public immutable token;
    address public immutable creditLine;
    address public immutable reserve;
    bool public immutable mockToken;
    uint64 public demoWindow = 600;

    mapping(address => address[]) internal _fundsOf;
    address[] internal _all;

    error DemoRequiresMock();
    error BadKind();
    error BadParam();

    event PlatformCreated(address indexed fund, address indexed issuer, QueueKind kind, string name);
    event DemoWindowSet(uint64 interval);

    constructor(address owner_, address adapter, address creditLine_, address reserve_) Ownable(owner_) {
        token = IUsdgAdapter(adapter).token();
        creditLine = creditLine_;
        reserve = reserve_;
        mockToken = IUsdgAdapter(adapter).isMock();
    }

    /// @inheritdoc IFundFactory
    function setDemoWindow(uint64 interval) external onlyOwner {
        if (interval == 0) revert BadParam();
        demoWindow = interval;
        emit DemoWindowSet(interval);
    }

    /// @inheritdoc IFundFactory
    function createDemoFund(string calldata fundName) external returns (address fund) {
        if (!mockToken) revert DemoRequiresMock();
        uint256 shares = DEMO_SHARE_VALUE * 1e18 / DEMO_NAV;
        fund = _deploy(
            PlatformConfig({
                token: token,
                creditLine: creditLine,
                reserve: reserve,
                issuer: msg.sender,
                name: fundName,
                nav: DEMO_NAV,
                interval: demoWindow,
                initialHolder: msg.sender,
                initialShares: shares
            }),
            QueueKind.QuarterlyGated
        );
        ILockgateCreditLine(creditLine).registerSource(fund, DEMO_LIMIT, DEMO_RESERVE_BPS);
        IMockUSDG(token).mint(address(this), DEMO_RESERVE + DEMO_CASH);
        IERC20(token).approve(reserve, DEMO_RESERVE);
        IPlatformReserve(reserve).post(fund, DEMO_RESERVE);
        IERC20(token).approve(fund, DEMO_CASH);
        QuarterlyWindowPlatform(fund).depositCash(DEMO_CASH);
    }

    /// @inheritdoc IFundFactory
    function createPlatform(
        QueueKind kind,
        string calldata fundName,
        uint64 interval,
        uint256 shareNav,
        uint256 limit,
        uint16 reserveBps
    ) external returns (address fund) {
        fund = _deploy(
            PlatformConfig({
                token: token,
                creditLine: creditLine,
                reserve: reserve,
                issuer: msg.sender,
                name: fundName,
                nav: shareNav,
                interval: interval,
                initialHolder: msg.sender,
                initialShares: 0
            }),
            kind
        );
        ILockgateCreditLine(creditLine).registerSource(fund, limit, reserveBps);
    }

    function fundsOf(address issuer) external view returns (address[] memory) {
        return _fundsOf[issuer];
    }

    function allFunds() external view returns (address[] memory) {
        return _all;
    }

    function _deploy(PlatformConfig memory cfg, QueueKind kind) internal returns (address fund) {
        if (kind == QueueKind.WeeklyCycle) fund = address(new WeeklyCyclePlatform(cfg));
        else if (kind == QueueKind.Epoch) fund = address(new EpochQueuePlatform(cfg));
        else if (kind == QueueKind.QuarterlyGated) fund = address(new QuarterlyWindowPlatform(cfg));
        else revert BadKind();
        _fundsOf[cfg.issuer].push(fund);
        _all.push(fund);
        emit PlatformCreated(fund, cfg.issuer, kind, cfg.name);
    }
}
