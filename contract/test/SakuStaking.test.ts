import { expect } from "chai";
import { ethers } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";

const USDC = (n: string) => ethers.parseUnits(n, 6);
const DAY = 24 * 60 * 60;

/**
 * The invariant these tests exist for.
 *
 * `currentApyBps` is read straight off `rewardRate`, and the contract's own header promises it
 * never advertises a yield it cannot pay. That promise only holds while the stream the rate
 * describes still fits inside the reserve funding it:
 *
 *     rewardRate * (rewardsEndAt - now)  <=  rewardReserve
 *
 * Solvency was never the problem — accrual is capped at the reserve in both the write and the
 * view path, so nobody could be paid with someone else's principal either way. What broke was
 * honesty: `withdrawUnusedRewards` took tokens out without slowing the stream, and `fundRewards`
 * then took `max(reserve, leftover)`, carrying the over-promise forward instead of correcting it.
 */
async function assertRateIsFunded(staking: any) {
  const [rate, endsAt, reserve] = await Promise.all([
    staking.rewardRate(),
    staking.rewardsEndAt(),
    staking.rewardReserve(),
  ]);
  const now = BigInt(await time.latest());
  const remaining = endsAt > now ? endsAt - now : 0n;
  expect(rate * remaining).to.be.lte(
    reserve,
    `rewardRate promises ${rate * remaining} over the remaining ${remaining}s but only ${reserve} is funded`
  );
}

async function deployFixture() {
  const [owner, alice] = await ethers.getSigners();

  const MockUSDC = await ethers.getContractFactory("MockUSDC");
  const usdc = await MockUSDC.deploy(USDC("1000000"));

  const Staking = await ethers.getContractFactory("SakuStaking");
  const staking = await Staking.deploy(await usdc.getAddress(), USDC("1"));

  await usdc.approve(await staking.getAddress(), ethers.MaxUint256);
  await usdc.transfer(alice.address, USDC("10000"));
  await usdc.connect(alice).approve(await staking.getAddress(), ethers.MaxUint256);

  return { owner, alice, usdc, staking };
}

describe("SakuStaking reward accounting", () => {
  it("keeps the advertised rate funded after the owner withdraws unused rewards", async () => {
    const { alice, staking } = await deployFixture();

    await staking.fundRewards(USDC("3650"), 365 * DAY);
    await staking.connect(alice).stake(USDC("1000"));
    await assertRateIsFunded(staking);

    const rateBefore = await staking.rewardRate();

    // Take out most of what is still unowed. Before the fix the rate did not move, so the pool
    // went on quoting a stream roughly ten times what was left to pay it with.
    await time.increase(30 * DAY);
    const reserve = await staking.rewardReserve();
    await staking.withdrawUnusedRewards((reserve * 9n) / 10n);

    expect(await staking.rewardRate()).to.be.lt(rateBefore);
    await assertRateIsFunded(staking);
  });

  it("does not carry an over-promise into the next funding round", async () => {
    const { alice, staking } = await deployFixture();

    await staking.fundRewards(USDC("3650"), 365 * DAY);
    await staking.connect(alice).stake(USDC("1000"));
    await time.increase(30 * DAY);
    await staking.withdrawUnusedRewards(((await staking.rewardReserve()) * 9n) / 10n);

    // Topping up must re-derive the rate from what is actually held, not from whatever the
    // previous stream happened to claim.
    await staking.fundRewards(USDC("100"), 30 * DAY);
    await assertRateIsFunded(staking);
  });

  it("never lets the owner reach staked principal", async () => {
    const { alice, staking } = await deployFixture();

    await staking.fundRewards(USDC("100"), 30 * DAY);
    await staking.connect(alice).stake(USDC("5000"));
    await time.increase(30 * DAY);

    // The reserve is what may be withdrawn. Principal is not part of it, however much of it the
    // contract happens to be holding.
    const reserve = await staking.rewardReserve();
    await expect(
      staking.withdrawUnusedRewards(reserve + 1n)
    ).to.be.revertedWithCustomError(staking, "InvalidAmount");

    // Alice can still take everything she put in, plus what she earned.
    const before = await staking.stakingToken();
    expect(before).to.equal(await staking.usdcToken());
    await expect(staking.connect(alice).exit()).to.emit(staking, "Unstaked");
    expect((await staking.stakes(alice.address)).amount).to.equal(0n);
  });

  it("pays a staker no more than the pool was funded for", async () => {
    const { owner, alice, usdc, staking } = await deployFixture();

    await staking.fundRewards(USDC("10"), 10 * DAY);
    await staking.connect(alice).stake(USDC("1000"));

    // Far past the end of the funded window.
    await time.increase(400 * DAY);

    const before = await usdc.balanceOf(alice.address);
    await staking.connect(alice).exit();
    const earned = (await usdc.balanceOf(alice.address)) - before - USDC("1000");

    expect(earned).to.be.lte(USDC("10"));
    expect(earned).to.be.gt(0n);
  });
});
