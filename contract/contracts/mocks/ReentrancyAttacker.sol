// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./ReentrantToken.sol";

/// @dev Only the surface the attack needs.
interface IEscrowUnderAttack {
    function lockForOfframp(
        uint256 amount,
        address token,
        bytes32 recipientPhoneHash,
        uint256 rateExpiry
    ) external returns (bytes32);

    function refund(bytes32 requestId) external;
}

/// @title ReentrancyAttacker
/// @notice Locks an off-ramp request as the requester, then tries to re-enter `refund` from inside
///         the token transfer that its own refund triggers.
/// @dev The attack runs in two modes, because they prove different things:
///
///      - bubbling (`swallow = false`): the inner revert propagates, so the whole refund transaction
///        dies. This is what proves the guard is what stopped it — the revert reason is
///        `ReentrancyGuardReentrantCall` and nothing else.
///      - swallowing (`swallow = true`): the inner revert is caught, so the outer refund completes
///        normally. This is the stronger assertion: exactly one payout, balances intact, and the
///        attacker's own flags showing the second attempt was made and refused.
contract ReentrancyAttacker is ITokenMoveHook {
    IEscrowUnderAttack public immutable escrow;
    ReentrantToken public immutable token;

    bytes32 public requestId;
    bool public armed;
    bool public swallowInnerRevert;

    /// Set when the callback actually fired — a test that passes because the hook never ran would
    /// prove nothing, so this is asserted too.
    bool public reentryAttempted;
    bool public reentryReverted;

    constructor(IEscrowUnderAttack _escrow, ReentrantToken _token) {
        escrow = _escrow;
        token = _token;
    }

    function lock(uint256 amount, bytes32 recipientPhoneHash, uint256 rateExpiry) external {
        token.approve(address(escrow), amount);
        // The hook stays off for this call on purpose: an armed token re-enters during
        // `safeTransferFrom` and the lock reverts before there is a request to attack.
        requestId = escrow.lockForOfframp(amount, address(token), recipientPhoneHash, rateExpiry);
    }

    function attackRefund(bool swallow) external {
        swallowInnerRevert = swallow;
        armed = true;
        token.setHook(address(this), true);
        escrow.refund(requestId);
    }

    /// @notice Re-entry attempt, called by the token from inside the escrow's payout transfer.
    function onTokenMoved() external override {
        // Once only. Left unbounded, a successful re-entry would recurse until it ran out of gas,
        // and an out-of-gas revert would look like a passing test while proving nothing.
        if (!armed) return;
        armed = false;
        reentryAttempted = true;

        if (swallowInnerRevert) {
            try escrow.refund(requestId) {
                // Reached only if a second refund went through — exactly the failure these tests
                // exist to catch. Left empty so the assertion lives in the test, not in a revert
                // string here.
            } catch {
                reentryReverted = true;
            }
        } else {
            escrow.refund(requestId);
        }
    }
}
