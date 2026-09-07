// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../interfaces/IChainlinkAggregatorV3.sol";

/// @notice Test-only Chainlink price feed stand-in with a settable answer.
contract MockV3Aggregator is IChainlinkAggregatorV3 {
    uint8 private immutable _decimals;
    int256 public latestAnswer;
    uint256 public latestTimestamp;
    uint80 public latestRound;

    constructor(uint8 decimals_, int256 initialAnswer) {
        _decimals = decimals_;
        latestAnswer = initialAnswer;
        latestTimestamp = block.timestamp;
        latestRound = 1;
    }

    function decimals() external view override returns (uint8) {
        return _decimals;
    }

    function updateAnswer(int256 answer_) external {
        latestAnswer = answer_;
        latestTimestamp = block.timestamp;
        latestRound++;
    }

    function latestRoundData()
        external
        view
        override
        returns (
            uint80 roundId,
            int256 answer,
            uint256 startedAt,
            uint256 updatedAt,
            uint80 answeredInRound
        )
    {
        return (latestRound, latestAnswer, latestTimestamp, latestTimestamp, latestRound);
    }
}
