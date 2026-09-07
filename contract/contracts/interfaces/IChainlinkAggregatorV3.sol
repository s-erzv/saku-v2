// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title IChainlinkAggregatorV3
/// @notice Minimal Chainlink AggregatorV3Interface, structurally identical to the interface
///         published in the official chainlink-contracts npm package. Declared locally so
///         this repo doesn't need to pull in the full Chainlink contracts package for one
///         interface.
interface IChainlinkAggregatorV3 {
    function decimals() external view returns (uint8);

    function latestRoundData()
        external
        view
        returns (
            uint80 roundId,
            int256 answer,
            uint256 startedAt,
            uint256 updatedAt,
            uint80 answeredInRound
        );
}
