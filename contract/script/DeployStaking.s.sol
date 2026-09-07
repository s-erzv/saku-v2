// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "../contracts/SakuStaking.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @notice Deploys SakuStaking against the already-deployed MockUSDC, then funds the reward
///         pool so the APY on screen is backed by tokens the contract actually holds.
contract DeployStaking is Script {
    function run() external {
        address usdc = vm.envAddress("MOCK_USDC_ADDRESS");
        uint256 minStake = 1e6;              // 1 USDC
        uint256 rewardAmount = 50_000 * 1e6; // 50k USDC of rewards
        uint256 duration = 365 days;

        vm.startBroadcast();

        SakuStaking staking = new SakuStaking(usdc, minStake);
        console2.log("SakuStaking:", address(staking));

        IERC20(usdc).approve(address(staking), rewardAmount);
        staking.fundRewards(rewardAmount, duration);
        console2.log("Funded rewards:", rewardAmount, "over (s):", duration);
        console2.log("APY bps (no stakers yet):", staking.currentApyBps());

        vm.stopBroadcast();
    }
}
