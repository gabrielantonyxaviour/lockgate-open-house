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
    function kind() external view returns (QueueKind);

    function cycleLength() external view returns (uint64);

    function currentCycleId() external view returns (uint256);

    function queueLength() external view returns (uint256);

    function queuedValue() external view returns (uint256);

    function lockgateOwed() external view returns (uint256);

    function cash() external view returns (uint256);

    /// @return id Lowest queued request id, or 0 when the queue is empty.
    function headRequestId() external view returns (uint256);

    /// @notice Cash is applied to Lockgate before the investor queue.
    ///         Weekly and quarterly pay whole requests FIFO. Epoch pays pro-rata.
    function previewSettlement()
        external
        view
        returns (uint256 cashBalance, uint256 repayFirst, uint256 queuePayable, uint256 queueShortfall);
}
