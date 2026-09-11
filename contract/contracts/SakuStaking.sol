// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/// @title SakuStaking
/// @notice Stake USDC, earn USDC. The accounting is the standard accumulator model v1 used:
///         rewards stream at a fixed rate per second, and each staker's claim is derived from
///         how the accumulator moved while their stake was in the pool. No loops over stakers,
///         so gas does not grow with participation.
///
/// @dev Two decisions worth stating, because both are places this kind of contract usually goes
///      wrong:
///
///      1. **Rewards are funded, not minted.** `fundRewards` moves real tokens in and buys a
///         duration of streaming at `rewardRate`. A pool that promises yield it cannot pay is
///         the failure mode here, so `pendingRewards` can never exceed what was funded: the
///         accumulator only advances while `rewardsEndAt` is in the future.
///
///      2. **Principal and rewards are the same token, and are tracked separately.**
///         `totalStaked` is never touched by reward accounting, and reward payouts come from
///         `rewardReserve`. Without that split, a staker unstaking could be paid with another
///         staker's principal — solvent on paper, insolvent in practice.
contract SakuStaking is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ============================================================
    // STATE
    // ============================================================

    IERC20 public immutable stakingToken;

    struct StakeInfo {
        uint256 amount;
        /// @dev Accumulator value already accounted for. The classic "reward debt".
        uint256 rewardDebt;
        uint256 stakedAt;
    }

    mapping(address => StakeInfo) public stakes;

    uint256 public totalStaked;

    /// @notice Tokens set aside to pay rewards. Never lent to principal, never staked.
    uint256 public rewardReserve;

    /// @notice Rewards streamed per second while the pool is funded.
    uint256 public rewardRate;

    /// @notice When the current funding runs out. Accrual stops here.
    uint256 public rewardsEndAt;

    /// @dev Rewards per staked token, scaled by 1e12 so integer division does not round small
    ///      stakes down to nothing.
    uint256 public accRewardPerShare;
    uint256 public lastRewardTime;

    uint256 private constant ACC_PRECISION = 1e12;

    /// @notice Smallest stake accepted. Below this the reward dust is not worth the gas.
    uint256 public minStakeAmount;

    // ============================================================
    // EVENTS
    // ============================================================

    event Staked(address indexed user, uint256 amount);
    event Unstaked(address indexed user, uint256 amount);
    event RewardsClaimed(address indexed user, uint256 amount);
    event RewardPoolAdded(uint256 amount, uint256 duration);
    event MinStakeUpdated(uint256 oldValue, uint256 newValue);

    // ============================================================
    // ERRORS
    // ============================================================

    error InvalidAddress();
    error InvalidAmount();
    error BelowMinimum();
    error NothingStaked();
    error InsufficientStake();
    error InvalidDuration();

    // ============================================================
    // CONSTRUCTOR
    // ============================================================

    constructor(address _stakingToken, uint256 _minStakeAmount) Ownable(msg.sender) {
        if (_stakingToken == address(0)) revert InvalidAddress();

        stakingToken = IERC20(_stakingToken);
        minStakeAmount = _minStakeAmount;
        lastRewardTime = block.timestamp;
    }

    // ============================================================
    // VIEWS
    // ============================================================

    /// @notice The token being staked. Named to match the v1 interface.
    function usdcToken() external view returns (address) {
        return address(stakingToken);
    }

    /// @dev The accumulator as it would be right now, without writing it.
    function _pendingAccRewardPerShare() internal view returns (uint256) {
        if (totalStaked == 0) return accRewardPerShare;

        // Accrual stops at `rewardsEndAt`: past it there is nothing funded to pay out, and
        // letting the accumulator run on would promise rewards the reserve cannot cover.
        uint256 upTo = block.timestamp < rewardsEndAt ? block.timestamp : rewardsEndAt;
        if (upTo <= lastRewardTime) return accRewardPerShare;

        uint256 accrued = (upTo - lastRewardTime) * rewardRate;
        if (accrued > rewardReserve) accrued = rewardReserve;

        return accRewardPerShare + (accrued * ACC_PRECISION) / totalStaked;
    }

    /// @notice Rewards `user` could claim right now.
    function pendingRewards(address user) public view returns (uint256) {
        StakeInfo memory info = stakes[user];
        if (info.amount == 0) return 0;

        uint256 acc = _pendingAccRewardPerShare();
        uint256 owed = (info.amount * acc) / ACC_PRECISION;

        return owed > info.rewardDebt ? owed - info.rewardDebt : 0;
    }

    /// @notice Everything a UI needs, in one call.
    function getStakeInfo(address user)
        external
        view
        returns (uint256 staked, uint256 pending, uint256 stakedAt, uint256 poolTotal)
    {
        StakeInfo memory info = stakes[user];
        return (info.amount, pendingRewards(user), info.stakedAt, totalStaked);
    }

    /// @notice Current annual rate in basis points, from the funded stream. 0 when unfunded.
    function currentApyBps() external view returns (uint256) {
        if (totalStaked == 0 || block.timestamp >= rewardsEndAt) return 0;
        return (rewardRate * 365 days * 10_000) / totalStaked;
    }

    // ============================================================
    // INTERNAL
    // ============================================================

    /// @dev Advance the accumulator to now. Must run before any change to a stake or the pool.
    function _updatePool() internal {
        uint256 upTo = block.timestamp < rewardsEndAt ? block.timestamp : rewardsEndAt;

        if (upTo <= lastRewardTime) {
            lastRewardTime = block.timestamp;
            return;
        }

        if (totalStaked > 0) {
            uint256 accrued = (upTo - lastRewardTime) * rewardRate;
            if (accrued > rewardReserve) accrued = rewardReserve;

            // Moved out of the reserve as it accrues, so the reserve always reflects what is
            // still owed but not yet earned.
            rewardReserve -= accrued;
            accRewardPerShare += (accrued * ACC_PRECISION) / totalStaked;
        }

        lastRewardTime = block.timestamp;
    }

    /// @dev Pay out whatever `user` has earned so far. Assumes `_updatePool` already ran.
    function _harvest(address user) internal returns (uint256 paid) {
        StakeInfo storage info = stakes[user];
        if (info.amount == 0) return 0;

        uint256 owed = (info.amount * accRewardPerShare) / ACC_PRECISION;
        if (owed <= info.rewardDebt) return 0;

        paid = owed - info.rewardDebt;
        info.rewardDebt = owed;

        if (paid > 0) {
            stakingToken.safeTransfer(user, paid);
            emit RewardsClaimed(user, paid);
        }
    }

    // ============================================================
    // CORE
    // ============================================================

    /// @notice Stake `amount`. Caller must have approved this contract first.
    function stake(uint256 amount) external nonReentrant {
        if (amount == 0) revert InvalidAmount();

        StakeInfo storage info = stakes[msg.sender];
        if (info.amount + amount < minStakeAmount) revert BelowMinimum();

        _updatePool();
        // Settle what is already earned before the stake size changes, otherwise the new,
        // larger stake would be credited for time it was not staked for.
        _harvest(msg.sender);

        stakingToken.safeTransferFrom(msg.sender, address(this), amount);

        info.amount += amount;
        info.stakedAt = block.timestamp;
        info.rewardDebt = (info.amount * accRewardPerShare) / ACC_PRECISION;

        totalStaked += amount;

        emit Staked(msg.sender, amount);
    }

    /// @notice Withdraw `amount` of principal. Earned rewards are paid out at the same time.
    function unstake(uint256 amount) external nonReentrant {
        StakeInfo storage info = stakes[msg.sender];
        if (info.amount == 0) revert NothingStaked();
        if (amount == 0 || amount > info.amount) revert InsufficientStake();

        _updatePool();
        _harvest(msg.sender);

        info.amount -= amount;
        info.rewardDebt = (info.amount * accRewardPerShare) / ACC_PRECISION;
        totalStaked -= amount;

        stakingToken.safeTransfer(msg.sender, amount);

        emit Unstaked(msg.sender, amount);
    }

    /// @notice Take earned rewards without touching the principal.
    function claimRewards() external nonReentrant returns (uint256) {
        if (stakes[msg.sender].amount == 0) revert NothingStaked();

        _updatePool();
        return _harvest(msg.sender);
    }

    /// @notice Withdraw everything, rewards included.
    function exit() external nonReentrant {
        StakeInfo storage info = stakes[msg.sender];
        uint256 amount = info.amount;
        if (amount == 0) revert NothingStaked();

        _updatePool();
        _harvest(msg.sender);

        info.amount = 0;
        info.rewardDebt = 0;
        totalStaked -= amount;

        stakingToken.safeTransfer(msg.sender, amount);

        emit Unstaked(msg.sender, amount);
    }

    // ============================================================
    // ADMIN
    // ============================================================

    /// @notice Fund the reward pool and stream it over `duration` seconds.
    /// @dev The tokens are pulled in here, so the pool can only ever pay what it holds.
    function fundRewards(uint256 amount, uint256 duration) external onlyOwner {
        if (amount == 0) revert InvalidAmount();
        if (duration == 0) revert InvalidDuration();

        _updatePool();

        stakingToken.safeTransferFrom(msg.sender, address(this), amount);
        rewardReserve += amount;

        // `rewardReserve` is, by definition, everything funded that has not yet accrued to a
        // staker — `_updatePool` above moved out whatever had. That already includes the unspent
        // remainder of the previous stream, so dividing it by the new duration rolls the old
        // funding forward without discarding it, and no separate leftover term is needed.
        //
        // The previous form was `max(rewardReserve, remaining * rewardRate) / duration`. When
        // the two disagreed it took the larger, which is the wrong half: they only disagree when
        // the old rate was already promising more than the reserve could pay, and taking it
        // carried that over-promise into the new stream instead of correcting it. Solvency was
        // never at risk, because accrual is capped at the reserve in both `_updatePool` and
        // `_pendingAccRewardPerShare` — but `currentApyBps` reads off `rewardRate`, so the
        // screen advertised a yield the pool could not fund. This contract says at the top that
        // it does not do that.
        rewardRate = rewardReserve / duration;
        rewardsEndAt = block.timestamp + duration;
        lastRewardTime = block.timestamp;

        emit RewardPoolAdded(amount, duration);
    }

    function setMinStakeAmount(uint256 newValue) external onlyOwner {
        emit MinStakeUpdated(minStakeAmount, newValue);
        minStakeAmount = newValue;
    }

    /// @notice Recover reward tokens that are not owed to anyone.
    /// @dev Bounded by `rewardReserve` — staked principal can never be withdrawn by the owner,
    ///      which is the whole point of separating the two balances.
    function withdrawUnusedRewards(uint256 amount) external onlyOwner {
        // Settle first, then check. `_updatePool` reduces `rewardReserve` by whatever accrued
        // since it last ran, so a bound tested before it is tested against a number that is
        // about to shrink. The subtraction below would then underflow and revert, which is safe
        // but reads as a mysterious failure on a withdrawal that looked valid.
        _updatePool();
        if (amount > rewardReserve) revert InvalidAmount();

        rewardReserve -= amount;

        // Taking tokens out without slowing the stream is what made an unfundable `rewardRate`
        // reachable at all: the reserve empties before `rewardsEndAt`, accrual silently truncates
        // against the cap, and the advertised APY keeps quoting the old rate. Re-derive it from
        // what is actually left over the time that is actually left.
        uint256 remaining = block.timestamp < rewardsEndAt ? rewardsEndAt - block.timestamp : 0;
        rewardRate = remaining > 0 ? rewardReserve / remaining : 0;

        stakingToken.safeTransfer(msg.sender, amount);
    }
}
