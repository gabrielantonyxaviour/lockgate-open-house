// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {AdvanceProposal} from "../../../src/interfaces/IAdvanceProposal.sol";
import {PartnerRouter} from "../../../src/partner/PartnerRouter.sol";
import {PartnerVault} from "../../../src/partner/PartnerVault.sol";

/// @notice USDG stand-in with a fee, a false return, a rebase, or a hook. Tests only.
contract WeirdUSDG is ERC20 {
    /// @dev 0 standard, 1 fee-on-transfer, 2 transfer returns false and moves nothing.
    uint8 public kind;
    address public target;
    bool public yank;
    /// @dev After a transfer, burn this many extra tokens from the recipient, capped by its balance.
    uint256 public clip;
    bool private _busy;

    constructor() ERC20("Weird USDG", "wUSDG") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function setKind(uint8 next) external {
        kind = next;
    }

    function arm(address next) external {
        target = next;
    }

    function setYank(bool next) external {
        yank = next;
    }

    function setClip(uint256 next) external {
        clip = next;
    }

    /// @notice Mint or burn `account` without a transfer. A negative rebase is `down`.
    function rebase(address account, uint256 amount, bool down) external {
        if (down) _burn(account, amount);
        else _mint(account, amount);
    }

    function transfer(address to, uint256 value) public override returns (bool) {
        if (kind == 2) return false;
        if (kind == 1) {
            _take(msg.sender, to, value);
            return true;
        }
        return super.transfer(to, value);
    }

    function transferFrom(address from, address to, uint256 value) public override returns (bool) {
        if (kind == 2) return false;
        if (kind == 1) {
            _spendAllowance(from, msg.sender, value);
            _take(from, to, value);
            return true;
        }
        return super.transferFrom(from, to, value);
    }

    function _take(address from, address to, uint256 value) internal {
        uint256 fee = value / 100;
        if (fee == 0) fee = 1;
        _transfer(from, to, value - fee);
        _burn(from, fee);
    }

    function _update(address from, address to, uint256 value) internal override {
        super._update(from, to, value);
        if (_busy) return;
        if (yank && to != address(0)) {
            _busy = true;
            _burn(to, value);
            _busy = false;
        }
        if (clip > 0 && to != address(0)) {
            _busy = true;
            uint256 take = clip;
            uint256 held = balanceOf(to);
            if (take > held) take = held;
            if (take > 0) _burn(to, take);
            _busy = false;
        }
        if (target != address(0)) {
            _busy = true;
            address who = target;
            target = address(0);
            (bool ok,) = who.call(abi.encodeWithSignature("onTokens()"));
            if (!ok) {
                _busy = false;
                return;
            }
            _busy = false;
        }
    }
}

/// @notice Called from the token. Tries the vault and the router again from inside the transfer.
contract TokenAttacker {
    PartnerVault public vault;
    address public router;
    address public platform;
    uint256 public repayId;
    bytes32 public exitRef;
    bytes4 public withdrawSel;
    bytes4 public repaySel;
    bytes4 public executeSel;
    bytes4 public postSel;
    bytes4 public relaySel;
    bool public withdrew;
    bool public repaid;
    bool public executed;
    bool public posted;
    bool public relayed;

    function configure(address vault_, address router_, address platform_, uint256 repayId_, bytes32 exitRef_) external {
        vault = PartnerVault(vault_);
        router = router_;
        platform = platform_;
        repayId = repayId_;
        exitRef = exitRef_;
    }

    function onTokens() external {
        try vault.withdraw(1, address(this)) returns (uint256) {
            withdrew = true;
        } catch (bytes memory err) {
            withdrawSel = _sel(err);
        }
        try vault.repay(repayId) {
            repaid = true;
        } catch (bytes memory err) {
            repaySel = _sel(err);
        }
        AdvanceProposal memory blank;
        try vault.execute(blank, "", "") returns (uint256) {
            executed = true;
        } catch (bytes memory err) {
            executeSel = _sel(err);
        }
        try vault.postReserve(platform, 1) {
            posted = true;
        } catch (bytes memory err) {
            postSel = _sel(err);
        }
        if (router != address(0)) {
            try PartnerRouter(router).relayRepay(exitRef, 0) {
                relayed = true;
            } catch (bytes memory err) {
                relaySel = _sel(err);
            }
        }
    }

    function _sel(bytes memory err) private pure returns (bytes4 sel) {
        if (err.length < 4) return bytes4(0);
        assembly {
            sel := mload(add(err, 32))
        }
    }
}
