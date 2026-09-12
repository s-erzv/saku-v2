// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "../interfaces/IPancakeRouter02.sol";

/// @dev Only the surface the attack needs.
interface IEscrowSettleUnderAttack {
    function settleOfframp(
        bytes32 requestId,
        address[] calldata path,
        uint256 minAmountOut
    ) external returns (uint256);

    function refund(bytes32 requestId) external;
}

/// @title ReentrantRouter
/// @notice A PancakeSwap router stand-in that re-enters the escrow from inside the settlement swap.
/// @dev `settleOfframp` makes one external call to an address it does not control the code of —
///      `pancakeRouter.swapExactTokensForTokens`. On BSC that is PancakeSwap, but the escrow cannot
///      know that, and the contract is written as though it might not be: status flips to `Settled`
///      before the swap, and the function is `nonReentrant`. This router is what tests that claim.
///
///      `pancakeRouter` is `immutable`, so a test using this has to deploy its own escrow pointed at
///      it rather than swapping the router in afterwards.
///
///      Which function to re-enter is a choice, and the two answers prove different things:
///
///      - `settleOfframp` never reaches the reentrancy guard at all. It is declared
///        `external onlySettler nonReentrant`, modifiers run in order, and this router is not the
///        settler — so the re-entry dies on access control first. Worth asserting as the fact it is.
///      - `refund` is permissionless by design (anyone may unlock an expired request), so it has no
///        access control in front of the guard. That makes it the call that actually tests whether
///        `nonReentrant` defends the swap's external call.
contract ReentrantRouter is IPancakeRouter02 {
    IEscrowSettleUnderAttack public escrow;
    bytes32 public requestId;
    bool public armed;
    bool public swallowInnerRevert;
    /// @notice Re-enter `refund` instead of `settleOfframp`.
    bool public reenterRefund;

    bool public reentryAttempted;
    bool public reentryReverted;

    /// @notice Load the shot. Separate from the swap so the request id — which only exists after a
    ///         lock — can be handed over once it is known.
    function arm(
        IEscrowSettleUnderAttack _escrow,
        bytes32 _requestId,
        bool swallow,
        bool viaRefund
    ) external {
        escrow = _escrow;
        requestId = _requestId;
        swallowInnerRevert = swallow;
        reenterRefund = viaRefund;
        armed = true;
    }

    function swapExactTokensForTokens(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 /* deadline */
    ) external override returns (uint256[] memory amounts) {
        require(path.length >= 2, "ReentrantRouter: bad path");

        // Take the locked token first, so by the time the re-entry happens the escrow has genuinely
        // parted with the funds — the worst moment for it to be re-entered.
        IERC20(path[0]).transferFrom(msg.sender, address(this), amountIn);

        if (armed) {
            armed = false;
            reentryAttempted = true;

            if (swallowInnerRevert) {
                if (reenterRefund) {
                    try escrow.refund(requestId) {
                        // Reached only if the guard let a refund run inside a settlement — which
                        // would mean the user was paid back tokens the escrow had just swapped away.
                    } catch {
                        reentryReverted = true;
                    }
                } else {
                    try escrow.settleOfframp(requestId, path, 0) {
                        // Reached only if a second settlement went through.
                    } catch {
                        reentryReverted = true;
                    }
                }
            } else if (reenterRefund) {
                escrow.refund(requestId);
            } else {
                escrow.settleOfframp(requestId, path, 0);
            }
        }

        // One-for-one, ignoring decimals: the exchange rate is not what is under test here, and the
        // escrow passes `minAmountOut` straight through, so the test sets that to 0.
        uint256 amountOut = amountIn;
        require(amountOut >= amountOutMin, "ReentrantRouter: INSUFFICIENT_OUTPUT_AMOUNT");
        IERC20(path[path.length - 1]).transfer(to, amountOut);

        amounts = new uint256[](path.length);
        amounts[0] = amountIn;
        amounts[amounts.length - 1] = amountOut;
    }

    function getAmountsOut(uint256 amountIn, address[] calldata path)
        external
        pure
        override
        returns (uint256[] memory amounts)
    {
        amounts = new uint256[](path.length);
        amounts[0] = amountIn;
        amounts[amounts.length - 1] = amountIn;
    }
}
