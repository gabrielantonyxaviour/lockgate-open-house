// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IFundFactory} from "../interfaces/IFundFactory.sol";
import {ILockgateCreditLine} from "../interfaces/ILockgateCreditLine.sol";
import {IPlatformReserve} from "../interfaces/IPlatformReserve.sol";
import {IUsdgAdapter} from "../interfaces/IUsdgAdapter.sol";
import {QueueKind} from "../interfaces/IQueueAdapter.sol";
import {IMockUSDG} from "../interfaces/IMockUSDG.sol";
import {IIssuerFund} from "../interfaces/IIssuerFund.sol";
import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";
import {PlatformConfig} from "./PlatformConfig.sol";
import {PlatformBase} from "./PlatformBase.sol";

/// @title FundFactory
/// @notice Sandbox platforms. `createDemoFund` seeds the MVP numbers and only works when the token is MockUSDG.
contract FundFactory is Ownable, IFundFactory {
    using SafeERC20 for IERC20;

    /// @notice Share price `createDemoFund` writes. 1_023_400.
    uint256 public constant DEMO_NAV = 1_023_400;
    /// @notice USDG of shares minted to the demo issuer. 10_000e6.
    uint256 public constant DEMO_SHARE_VALUE = 10_000e6;
    /// @notice USDG `createDemoFund` deposits as cash. 2_000e6.
    uint256 public constant DEMO_CASH = 2_000e6;
    /// @notice Draw limit registered for the demo fund. 25_000e6.
    uint256 public constant DEMO_LIMIT = 25_000e6;
    /// @notice Reserve rate registered for the demo fund. 750 bps.
    uint16 public constant DEMO_RESERVE_BPS = 750;
    /// @notice USDG posted to the demo reserve. 1_875e6.
    uint256 public constant DEMO_RESERVE = 1_875e6;

    /// @notice USDG the factory's platforms use.
    address public immutable token;
    /// @notice Line `createPlatform` registers the new fund on.
    address public immutable creditLine;
    /// @notice Reserve the demo fund posts to.
    address public immutable reserve;
    /// @notice Clone target for a weekly platform.
    address public immutable weeklyImpl;
    /// @notice Clone target for an epoch platform.
    address public immutable epochImpl;
    /// @notice Clone target for a quarterly platform.
    address public immutable quarterImpl;
    /// @notice True when the adapter was constructed as MockUSDG.
    bool public immutable mockToken;
    /// @inheritdoc IFundFactory
    uint64 public demoWindow = 600;

    mapping(address => address[]) internal _fundsOf;
    address[] internal _all;

    error DemoRequiresMock();
    error BadKind();
    error BadParam();
    error ZeroAddress();

    event PlatformCreated(address indexed fund, address indexed issuer, QueueKind kind, string name);
    event DemoWindowSet(uint64 interval);

    /// @param weekly_ Locked implementation. This factory clones it. It does not embed platform bytecode.
    constructor(
        address owner_,
        address adapter,
        address creditLine_,
        address reserve_,
        address weekly_,
        address epoch_,
        address quarter_
    ) Ownable(owner_) {
        if (
            adapter == address(0) || creditLine_ == address(0) || reserve_ == address(0) || weekly_ == address(0)
                || epoch_ == address(0) || quarter_ == address(0)
        ) revert ZeroAddress();
        token = IUsdgAdapter(adapter).token();
        creditLine = creditLine_;
        reserve = reserve_;
        weeklyImpl = weekly_;
        epochImpl = epoch_;
        quarterImpl = quarter_;
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
        IERC20(token).forceApprove(reserve, DEMO_RESERVE);
        IPlatformReserve(reserve).post(fund, DEMO_RESERVE);
        IERC20(token).forceApprove(fund, DEMO_CASH);
        IIssuerFund(fund).depositCash(DEMO_CASH);
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

    /// @inheritdoc IFundFactory
    function fundsOf(address issuer) external view returns (address[] memory) {
        return _fundsOf[issuer];
    }

    /// @inheritdoc IFundFactory
    function allFunds() external view returns (address[] memory) {
        return _all;
    }

    function _deploy(PlatformConfig memory cfg, QueueKind kind) internal returns (address fund) {
        address impl;
        if (kind == QueueKind.WeeklyCycle) impl = weeklyImpl;
        else if (kind == QueueKind.Epoch) impl = epochImpl;
        else if (kind == QueueKind.QuarterlyGated) impl = quarterImpl;
        else revert BadKind();
        fund = Clones.clone(impl);
        PlatformBase(fund).initialize(cfg);
        _fundsOf[cfg.issuer].push(fund);
        _all.push(fund);
        emit PlatformCreated(fund, cfg.issuer, kind, cfg.name);
    }
}
