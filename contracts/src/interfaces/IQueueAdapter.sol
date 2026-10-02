// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice How a platform's withdrawal queue settles. Numeric values match the off-chain engine's `kindCode`.
enum QueueKind {
    None,
    WeeklyCycle,
    Epoch,
    QuarterlyGated
}

/// @notice Read model of a platform queue. Mocks and, later, real adapters implement this.
interface IQueueAdapter {
    /// @notice Which queue this platform settles.
    function kind() external view returns (QueueKind);

    /// @notice Seconds between windows. Matches the fund's `windowInterval`.
    function cycleLength() external view returns (uint64);

    /// @notice Starts at 1. Increases only when a window clears Lockgate.
    function currentCycleId() external view returns (uint256);

    /// @notice Queued requests. An advanced request has left this count.
    function queueLength() external view returns (uint256);

    /// @notice Sum of queued requests' nav, in USDG units.
    function queuedValue() external view returns (uint256);

    /// @notice Sum of `remainingOf` for advances still on the open list.
    function lockgateOwed() external view returns (uint256);

    /// @notice USDG held by this contract, including a direct transfer.
    function cash() external view returns (uint256);

    /// @return id Lowest queued request id, or 0 when the queue is empty.
    function headRequestId() external view returns (uint256);

    /// @notice Cash is applied to Lockgate before the investor queue.
    ///         Weekly and quarterly pay whole requests FIFO. Epoch pays pro-rata,
    ///         and this preview counts only the slices that burn shares.
    function previewSettlement()
        external
        view
        returns (uint256 cashBalance, uint256 repayFirst, uint256 queuePayable, uint256 queueShortfall);
}
