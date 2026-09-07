// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title IPancakeRouter02
/// @notice Minimal PancakeSwap V2 Router interface (API-compatible with Uniswap V2 Router02).
/// @dev Only the surface SakuOfframpEscrow needs — full ABI at
///      https://docs.pancakeswap.finance/developers/smart-contracts/pancakeswap-exchange/v2-contracts/router-v2
interface IPancakeRouter02 {
    function swapExactTokensForTokens(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external returns (uint256[] memory amounts);

    function getAmountsOut(uint256 amountIn, address[] calldata path)
        external
        view
        returns (uint256[] memory amounts);
}
