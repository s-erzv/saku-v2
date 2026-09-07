// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "../interfaces/IPancakeRouter02.sol";

/// @notice Test-only PancakeSwap router stand-in: swaps at a fixed, settable rate instead of
///         using a real liquidity pool. Must be pre-funded with the output token before
///         `swapExactTokensForTokens` is called, since it pays out of its own balance.
contract MockPancakeRouter is IPancakeRouter02 {
    uint256 public rateNumerator = 1;
    uint256 public rateDenominator = 1;
    bool public shouldRevert;

    function setRate(uint256 numerator, uint256 denominator) external {
        require(denominator > 0, "MockPancakeRouter: bad denominator");
        rateNumerator = numerator;
        rateDenominator = denominator;
    }

    function setShouldRevert(bool value) external {
        shouldRevert = value;
    }

    function swapExactTokensForTokens(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 /* deadline */
    ) external override returns (uint256[] memory amounts) {
        require(!shouldRevert, "MockPancakeRouter: forced revert");
        require(path.length >= 2, "MockPancakeRouter: bad path");

        uint256 amountOut = (amountIn * rateNumerator) / rateDenominator;
        require(amountOut >= amountOutMin, "MockPancakeRouter: INSUFFICIENT_OUTPUT_AMOUNT");

        IERC20(path[0]).transferFrom(msg.sender, address(this), amountIn);
        IERC20(path[path.length - 1]).transfer(to, amountOut);

        amounts = new uint256[](path.length);
        amounts[0] = amountIn;
        amounts[amounts.length - 1] = amountOut;
    }

    function getAmountsOut(uint256 amountIn, address[] calldata path)
        external
        view
        override
        returns (uint256[] memory amounts)
    {
        amounts = new uint256[](path.length);
        amounts[0] = amountIn;
        amounts[amounts.length - 1] = (amountIn * rateNumerator) / rateDenominator;
    }
}
