// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Lockgate's own-book USDG credit line. Stage 1. Partner vaults are a different contract (G7).
interface ILockgateCreditLine {
    enum AdvanceStatus { Active, Repaid, Late }

    struct Advance {
        address source;
        address to;
        uint256 principal;
        uint256 fee;
        uint64 drawnAt;
        uint64 dueAt;
        AdvanceStatus status;
    }

    event SourceRegistered(address indexed source, uint256 limit, uint16 reserveBps);
    event SourceUpdated(address indexed source, uint256 limit, uint16 reserveBps, uint16 riskBps);
    event SourceDeregistered(address indexed source);
    event RegistrarSet(address indexed registrar, bool allowed);
    event CapitalDeposited(address indexed from, uint256 amount);
    event CapitalWithdrawn(address indexed to, uint256 amount);
    event AdvanceDrawn(
        uint256 indexed advanceId,
        address indexed source,
        address indexed to,
        uint256 principal,
        uint256 fee,
        uint64 dueAt
    );
    event AdvanceRepaid(uint256 indexed advanceId, address indexed source, uint256 amount, AdvanceStatus status);
    event AdvanceMarkedLate(uint256 indexed advanceId, address indexed source, uint256 slashed, uint256 shortfall);
    event GraceSet(uint64 grace);
    event CapsSet(uint16 maxUtilizationBps, uint16 maxConcentrationBps);
    event ReserveFloorSet(address indexed source, uint16 bps);
    /// @notice `from` is the caller who funded `postReserve`. The reserve's own `Posted` names this line.
    event ReservePosted(address indexed source, address indexed from, uint256 amount);

    /// @notice Owner or registrar. A registrar's call reverts when the source is registered or still listed. Pause blocks this call.
    function registerSource(address source, uint256 limit, uint16 reserveBps) external;

    /// @notice Owner. A lower reserve rate leaves the floor in place while this source is exposed.
    function setSourceTerms(address source, uint256 limit, uint16 reserveBps, uint16 riskBps) external;

    /// @notice Owner. Reverts `StillExposed` while this source is exposed. The address stays listed.
    function deregisterSource(address source) external;

    /// @notice Owner grants or revokes a registrar. The owner can register without this role.
    function setRegistrar(address registrar, bool allowed) external;

    /// @notice Owner. Pulls USDG onto this contract. Pause leaves this call open.
    function depositCapital(uint256 amount) external;

    /// @notice Owner. Sends equity above unpaid principal. Pause blocks this call. Equity counts fees only after they are realized.
    function withdrawCapital(uint256 amount) external;

    /// @notice Owner. Blocks `draw`, `registerSource`, and `withdrawCapital`. `repay`, `markLate`, `postReserve`, and `depositCapital` stay open.
    function pause() external;

    /// @notice Owner. Clears the pause and leaves every open advance where it is.
    function unpause() external;

    /// @notice Owner. The next draw stores this grace. An open advance keeps `graceOf`.
    function setGrace(uint64 grace_) external;

    /// @notice Owner. Both caps are 0–10_000 bps and bind later draws. An open advance keeps its stored terms.
    function setCaps(uint16 maxUtilizationBps, uint16 maxConcentrationBps) external;

    /// @notice Pulls USDG from the caller and posts it as this source's first-loss reserve. Pause leaves this call open.
    function postReserve(address source, uint256 amount) external;

    /// @notice USDG posted for `source` in the reserve.
    function reserveOf(address source) external view returns (uint256);

    /// @notice Draw limit for `source`, in owed-nav units.
    function limitOf(address source) external view returns (uint256);

    /// @notice Live reserve rate in bps. `reserveFloorBps` can be higher while exposure is open.
    function reserveBpsOf(address source) external view returns (uint16);

    /// @notice Reserve bps the open exposure still requires. Falls to the live rate only when exposure is 0.
    function reserveFloorBps(address source) external view returns (uint16);

    /// @notice Platform risk score, 0–10_000. The pricing engine scales its risk premium by this.
    function riskOf(address source) external view returns (uint16);

    /// @notice Unpaid obligation (principal + fee − recovered) for the source.
    function exposure(address source) external view returns (uint256);

    /// @notice Ceil of exposure times the active reserve rate. Zero when exposure or that rate is 0.
    function requiredReserve(address source) external view returns (uint256);

    /// @notice Priced fee for a draw of `navValue`. An unavailable quote returns fee 0 and a reason. Moves no tokens.
    function quote(address source, uint256 navValue)
        external
        view
        returns (uint256 fee, uint16 feeBps, bool available, string memory reason);

    /// @notice Registered source only. Pays `navValue - fee` to `to`. The source owes `navValue` back.
    function draw(uint256 navValue, address to, uint256 maxFee) external returns (uint256 advanceId, uint256 fee);

    /// @notice Anyone. Pulls the unpaid obligation from the source. Active becomes Repaid. Late stays Late.
    function repay(uint256 advanceId) external;

    /// @notice Anyone, after `dueAt + graceOf(id)`. Slashes the source reserve into this contract, up to the unpaid amount.
    function markLate(uint256 advanceId) external;

    /// @notice USDG held by this contract, including a direct transfer.
    function capital() external view returns (uint256);

    /// @notice Unpaid principal. A fee counts here only after recovery passes principal.
    function outstanding() external view returns (uint256);

    /// @notice Token balance plus unpaid principal. Equals `accountedEquity` until a direct token donation.
    function accountedAssets() external view returns (uint256);

    /// @notice Deposited capital plus realized fees, minus withdrawals. Idle cash the owner can withdraw is this minus `outstanding`.
    function accountedEquity() external view returns (uint256);

    /// @notice Floor of unpaid principal over `capital + outstanding`, in bps. The draw gate rounds utilization up.
    function utilizationBps() external view returns (uint16);

    /// @notice Fees realized once recovery passes principal.
    function earnedFees() external view returns (uint256);

    /// @notice Every source ever listed, including one the owner has deregistered.
    function sources() external view returns (address[] memory);

    /// @notice Stored advance. Id 0 and unknown ids are empty.
    function getAdvance(uint256 id) external view returns (Advance memory);

    /// @notice Advance ids drawn by `source`, in draw order.
    function advancesOf(address source) external view returns (uint256[] memory);

    /// @notice Highest advance id. The next draw uses this plus one.
    function advanceCount() external view returns (uint256);

    /// @notice USDG applied to this advance by repay or slash.
    function recoveredOf(uint256 id) external view returns (uint256);

    /// @notice Unpaid principal plus fee. Zero when the id is unknown or fully recovered.
    function remainingOf(uint256 id) external view returns (uint256);

    /// @notice Grace the next draw stores. Open advances use `graceOf`.
    function grace() external view returns (uint64);

    /// @notice Grace stored when `id` was drawn. `grace()` is the value the next draw stores. Unknown ids return 0.
    function graceOf(uint256 id) external view returns (uint64);

    /// @notice True after `pause` and before `unpause`.
    function paused() external view returns (bool);

    /// @notice Unpaid obligation on Active advances, in owed-nav units (principal + fee − recovered).
    function eligibleOutstanding() external view returns (uint256);

    /// @notice Unpaid obligation on Late advances, in the same units. A fully covered late advance adds 0.
    function lateOutstanding() external view returns (uint256);

    /// @notice Sum of source exposure, in owed-nav units. Equals `eligibleOutstanding + lateOutstanding`.
    function totalExposure() external view returns (uint256);
}
