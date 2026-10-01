// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "./IERC20.sol";

interface IEngine {
    function feeBps(uint256 secondsToWindow, uint256 navAge, bool gated, uint16 exposureBps, uint16 utilizationBps)
        external view returns (uint16 bps, bool available, string memory reason);
}

interface IQueue {
    function nextWindow() external view returns (uint64);
    function navUpdatedAt() external view returns (uint64);
    function gated() external view returns (bool);
}

interface IVault {
    function owner() external view returns (address);
    function router() external view returns (address);
    function idle() external view returns (uint256);
    function nonce() external view returns (uint256);
    function minFeeBps() external view returns (uint16);
    function eligible(address platform, uint256 navValue, uint256 fee, uint64 dueAt) external view returns (bool ok, string memory reason);
    function executeAdvance(address platform, address recipient, uint256 navValue, uint256 fee, uint64 dueAt, uint256 nonce, uint64 expiry, bytes calldata sig) external returns (uint256);
    function noteRepay(uint256 amount, address platform) external;
}

/// @title Router
/// @notice Picks one enlisted partner vault per exit. Policy 0 lowest min fee, 1 idle-weighted, 2 round-robin.
///         Repayments are pulled from the platform and sent to the vault that funded the advance.
///         Listing requires the vault owner. Lockgate cannot enlist a vault it does not own.
contract Router {
    enum Policy { BestFee, ProRata, RoundRobin }

    struct Route { address vault; address platform; address recipient; uint256 owed; bool open; }

    IERC20 public immutable usdg;
    IEngine public immutable engine;
    address public immutable operator;
    Policy public policy;
    uint256 public cursor;
    uint256 public routeCount;
    address[] public vaults;
    mapping(address => bool) public listed;
    mapping(uint256 => Route) private _routes;

    error None(string reason);
    error NotOwner();
    error NotOperator();
    error Closed();
    error Quote(string reason);

    event PolicySet(Policy policy);
    event VaultEnlisted(address indexed vault, address indexed owner);
    event Routed(uint256 indexed id, address indexed vault, address indexed platform, uint256 navValue, uint256 fee);
    event RouteRepaid(uint256 indexed id, address indexed vault, uint256 amount);

    constructor(address usdg_, address engine_, address operator_) {
        if (operator_ == address(0)) revert NotOperator();
        usdg = IERC20(usdg_);
        engine = IEngine(engine_);
        operator = operator_;
    }

    function setPolicy(Policy next) external {
        if (msg.sender != operator) revert NotOperator();
        policy = next;
        emit PolicySet(next);
    }

    function enlist(address vault) external {
        if (listed[vault]) return;
        if (IVault(vault).owner() != msg.sender) revert NotOwner();
        if (IVault(vault).router() != address(this)) revert NotOwner();
        listed[vault] = true;
        vaults.push(vault);
        emit VaultEnlisted(vault, msg.sender);
    }

    function vaultCount() external view returns (uint256) { return vaults.length; }

    function getRoute(uint256 id) external view returns (Route memory) { return _routes[id]; }

    function preview(address platform, uint256 navValue, uint64 expiry)
        public
        view
        returns (address vault, uint256 fee, uint16 feeBps, uint64 dueAt, uint256 nonce_)
    {
        if (expiry < block.timestamp) revert Quote("sig-expired");
        (fee, feeBps, dueAt) = _price(platform, navValue);
        vault = _select(platform, navValue, fee, dueAt);
        if (vault == address(0)) revert None("none");
        nonce_ = IVault(vault).nonce();
    }

    function advance(address platform, address recipient, uint256 navValue, uint64 expiry, bytes calldata sig)
        external
        returns (uint256 id, address vault, uint256 fee)
    {
        uint64 dueAt;
        uint256 nonce_;
        (vault, fee, , dueAt, nonce_) = preview(platform, navValue, expiry);
        IVault(vault).executeAdvance(platform, recipient, navValue, fee, dueAt, nonce_, expiry, sig);
        id = ++routeCount;
        _routes[id] = Route({ vault: vault, platform: platform, recipient: recipient, owed: navValue, open: true });
        if (policy == Policy.RoundRobin || policy == Policy.ProRata) cursor += 1;
        emit Routed(id, vault, platform, navValue, fee);
    }

    function repay(uint256 id) external {
        Route storage r = _routes[id];
        if (!r.open) revert Closed();
        r.open = false;
        usdg.transferFrom(r.platform, r.vault, r.owed);
        IVault(r.vault).noteRepay(r.owed, r.platform);
        emit RouteRepaid(id, r.vault, r.owed);
    }

    function _price(address platform, uint256 navValue) internal view returns (uint256 fee, uint16 feeBps, uint64 dueAt) {
        IQueue q = IQueue(platform);
        uint64 next = q.nextWindow();
        if (next <= block.timestamp) revert Quote("window");
        dueAt = next;
        uint256 wait = uint256(next) - block.timestamp;
        uint64 updated = q.navUpdatedAt();
        uint256 navAge = block.timestamp > updated ? block.timestamp - updated : 0;
        (uint16 bps, bool ok, string memory why) = engine.feeBps(wait, navAge, q.gated(), 0, 0);
        if (!ok) revert Quote(why);
        fee = navValue * bps / 10_000;
        if (fee == 0 || fee >= navValue) revert Quote("fee");
        feeBps = bps;
    }

    function _select(address platform, uint256 navValue, uint256 fee, uint64 dueAt) internal view returns (address chosen) {
        uint256 n = vaults.length;
        address[] memory ok = new address[](n);
        uint256 c;
        uint256 totalIdle;
        for (uint256 i = 0; i < n; i++) {
            (bool good,) = IVault(vaults[i]).eligible(platform, navValue, fee, dueAt);
            if (!good) continue;
            ok[c] = vaults[i];
            totalIdle += IVault(vaults[i]).idle();
            c++;
        }
        if (c == 0) return address(0);
        if (policy == Policy.BestFee) {
            chosen = ok[0];
            uint16 best = IVault(ok[0]).minFeeBps();
            for (uint256 i = 1; i < c; i++) {
                uint16 m = IVault(ok[i]).minFeeBps();
                if (m < best || (m == best && ok[i] < chosen)) {
                    best = m;
                    chosen = ok[i];
                }
            }
            return chosen;
        }
        if (policy == Policy.RoundRobin) return ok[cursor % c];
        uint256 pick = uint256(keccak256(abi.encode(platform, navValue, cursor))) % totalIdle;
        uint256 acc;
        for (uint256 i = 0; i < c; i++) {
            acc += IVault(ok[i]).idle();
            if (pick < acc) return ok[i];
        }
        return ok[c - 1];
    }
}
