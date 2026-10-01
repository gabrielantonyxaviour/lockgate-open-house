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

    function registerSource(address source, uint256 limit, uint16 reserveBps) external;

    function setSourceTerms(address source, uint256 limit, uint16 reserveBps, uint16 riskBps) external;

    function deregisterSource(address source) external;

    function setRegistrar(address registrar, bool allowed) external;

    function depositCapital(uint256 amount) external;

    function withdrawCapital(uint256 amount) external;

    function pause() external;

    function unpause() external;

    function setGrace(uint64 grace_) external;

    function setCaps(uint16 maxUtilizationBps, uint16 maxConcentrationBps) external;

    function postReserve(address source, uint256 amount) external;

    function reserveOf(address source) external view returns (uint256);

    function limitOf(address source) external view returns (uint256);

    function reserveBpsOf(address source) external view returns (uint16);

    /// @notice Reserve bps the open exposure still requires. Falls to the live rate only when exposure is 0.
    function reserveFloorBps(address source) external view returns (uint16);

    function riskOf(address source) external view returns (uint16);

    /// @notice Unpaid obligation (principal + fee − recovered) for the source.
    function exposure(address source) external view returns (uint256);

    function requiredReserve(address source) external view returns (uint256);

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

    function capital() external view returns (uint256);

    function outstanding() external view returns (uint256);

    function utilizationBps() external view returns (uint16);

    function earnedFees() external view returns (uint256);

    function sources() external view returns (address[] memory);

    function getAdvance(uint256 id) external view returns (Advance memory);

    function advancesOf(address source) external view returns (uint256[] memory);

    function advanceCount() external view returns (uint256);

    function recoveredOf(uint256 id) external view returns (uint256);

    function remainingOf(uint256 id) external view returns (uint256);

    function grace() external view returns (uint64);

    /// @notice Grace stored when `id` was drawn. `grace()` is the value the next draw stores. Unknown ids return 0.
    function graceOf(uint256 id) external view returns (uint64);

    function paused() external view returns (bool);

    /// @notice Unpaid obligation on Active advances, in owed-nav units (principal + fee − recovered).
    function eligibleOutstanding() external view returns (uint256);

    /// @notice Unpaid obligation on Late advances, in the same units. A fully covered late advance adds 0.
    function lateOutstanding() external view returns (uint256);
}
