// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

interface ITokenMoveHook {
    function onTokenMoved() external;
}

/// @title ReentrantToken
/// @notice Test-only ERC20 that calls back into a chosen contract on every balance movement.
/// @dev Why a token and not a `receive()`/`fallback()` attacker: `SakuOfframpEscrow` never sends
///      native value. It has no `payable` function, no `receive`, no `fallback` and no
///      `.call{value:}`, so there is no path by which an attacker's ether-receiving hook could ever
///      be entered. What it does send is ERC20 — `refund` ends in `safeTransfer`, `lockForOfframp`
///      in `safeTransferFrom` — and a token may do whatever it likes inside its own transfer. That
///      is the only reentrancy surface this contract actually has, so it is the one worth testing.
///
///      OpenZeppelin v5 funnels every mint, burn and transfer through `_update`, which makes it the
///      single hook to override. The callback fires *after* `super._update`, which is the realistic
///      moment: the token's own books are settled and the escrow is still mid-function.
contract ReentrantToken is ERC20 {
    address public hook;
    bool public hookEnabled;

    constructor(uint256 initialSupply) ERC20("Reentrant Token", "RNT") {
        _mint(msg.sender, initialSupply);
    }

    /// @notice Six decimals, matching the USDC stand-in this substitutes for in the escrow tests.
    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    /// @notice Point the callback at `target`, or turn it off. Deliberately unguarded: this is a
    ///         test double, and the attacker contract has to be able to arm it mid-test.
    function setHook(address target, bool enabled) external {
        hook = target;
        hookEnabled = enabled;
    }

    function _update(address from, address to, uint256 value) internal override {
        super._update(from, to, value);

        if (hookEnabled && hook != address(0)) {
            ITokenMoveHook(hook).onTokenMoved();
        }
    }
}
