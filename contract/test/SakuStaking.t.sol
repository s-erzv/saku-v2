// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../contracts/SakuStaking.sol";
import "../contracts/MockUSDC.sol";

/// @notice Reward-accounting tests for SakuStaking.
///
/// The property that matters most is solvency: at every point, the contract must hold at least
/// the staked principal plus everything it says is claimable. A staking pool that pays one user
/// out of another's principal balances on paper and fails on the last withdrawal.
contract SakuStakingTest is Test {
    SakuStaking staking;
    MockUSDC usdc;

    address alice = address(0xA11CE);
    address bob = address(0xB0B);

    uint256 constant ONE = 1e6; // USDC has 6 decimals

    function setUp() public {
        usdc = new MockUSDC(1_000_000 * ONE);
        staking = new SakuStaking(address(usdc), ONE);

        usdc.mint(alice, 1_000 * ONE);
        usdc.mint(bob, 1_000 * ONE);

        // Fund 100 USDC of rewards streaming over 100 seconds: 1 USDC/sec, easy to reason about.
        usdc.approve(address(staking), 100 * ONE);
        staking.fundRewards(100 * ONE, 100);
    }

    function _stake(address who, uint256 amount) internal {
        vm.startPrank(who);
        usdc.approve(address(staking), amount);
        staking.stake(amount);
        vm.stopPrank();
    }

    /// A lone staker earns the whole stream.
    function test_singleStakerEarnsFullRate() public {
        _stake(alice, 100 * ONE);

        vm.warp(block.timestamp + 10);

        assertApproxEqAbs(staking.pendingRewards(alice), 10 * ONE, 1, "10s at 1/sec");
    }

    /// Two equal stakes split the stream evenly for the time they overlap.
    function test_rewardsSplitByShare() public {
        _stake(alice, 100 * ONE);
        _stake(bob, 100 * ONE);

        vm.warp(block.timestamp + 10);

        assertApproxEqAbs(staking.pendingRewards(alice), 5 * ONE, 1e3, "half the stream");
        assertApproxEqAbs(staking.pendingRewards(bob), 5 * ONE, 1e3, "half the stream");
    }

    /// Staking later must not backdate rewards to before the stake existed.
    function test_lateStakerEarnsNothingForEarlierTime() public {
        _stake(alice, 100 * ONE);
        vm.warp(block.timestamp + 10);

        _stake(bob, 100 * ONE);
        assertEq(staking.pendingRewards(bob), 0, "no rewards for time before staking");

        // Alice keeps what she earned alone.
        assertApproxEqAbs(staking.pendingRewards(alice), 10 * ONE, 1e3, "alice keeps her 10");
    }

    /// Claiming pays out and resets the claim, without touching principal.
    function test_claimPaysAndResets() public {
        _stake(alice, 100 * ONE);
        vm.warp(block.timestamp + 10);

        uint256 before = usdc.balanceOf(alice);
        vm.prank(alice);
        staking.claimRewards();

        assertApproxEqAbs(usdc.balanceOf(alice) - before, 10 * ONE, 1e3, "paid ~10");
        assertEq(staking.pendingRewards(alice), 0, "claim resets");
        (uint256 stakedAmount,,,) = staking.getStakeInfo(alice);
        assertEq(stakedAmount, 100 * ONE, "principal untouched");
    }

    /// Accrual stops when the funded window ends — the pool never promises unfunded yield.
    function test_accrualStopsWhenFundingRunsOut() public {
        _stake(alice, 100 * ONE);

        vm.warp(block.timestamp + 500); // far past the 100s window

        assertApproxEqAbs(staking.pendingRewards(alice), 100 * ONE, 1e3, "capped at what was funded");
    }

    /// Unstaking returns principal and pays rewards in the same call.
    function test_unstakeReturnsPrincipalAndRewards() public {
        _stake(alice, 100 * ONE);
        vm.warp(block.timestamp + 10);

        uint256 before = usdc.balanceOf(alice);
        vm.prank(alice);
        staking.unstake(100 * ONE);

        uint256 gained = usdc.balanceOf(alice) - before;
        assertApproxEqAbs(gained, 110 * ONE, 1e3, "principal + rewards");
        assertEq(staking.totalStaked(), 0, "pool empty");
    }

    /// The core invariant: the contract can always pay everyone.
    function test_remainsSolvent() public {
        _stake(alice, 100 * ONE);
        _stake(bob, 300 * ONE);

        vm.warp(block.timestamp + 37);

        uint256 owed = staking.totalStaked() + staking.pendingRewards(alice) + staking.pendingRewards(bob);
        assertGe(usdc.balanceOf(address(staking)), owed, "holds principal + claimable");

        // And everyone can actually get out.
        vm.prank(alice);
        staking.exit();
        vm.prank(bob);
        staking.exit();

        assertEq(staking.totalStaked(), 0, "everyone exited");
    }

    /// The owner must not be able to reach staked principal.
    function test_ownerCannotWithdrawPrincipal() public {
        _stake(alice, 100 * ONE);

        // Reserve is what is left unstreamed; principal is not part of it.
        vm.expectRevert(SakuStaking.InvalidAmount.selector);
        staking.withdrawUnusedRewards(200 * ONE);
    }

    function test_belowMinimumRejected() public {
        vm.startPrank(alice);
        usdc.approve(address(staking), ONE / 2);
        vm.expectRevert(SakuStaking.BelowMinimum.selector);
        staking.stake(ONE / 2);
        vm.stopPrank();
    }
}
