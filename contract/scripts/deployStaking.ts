import { ethers } from "hardhat";

/**
 * Deploy SakuStaking to BSC Testnet and fund its reward pool.
 *
 * Funding is part of the deployment, not a follow-up step, because `currentApyBps` reads off
 * `rewardRate` and an unfunded pool would quote a yield of zero to anyone who opened the screen
 * between the two transactions. The contract's own rule is that rewards are funded, not minted.
 *
 * Mirrors script/DeployStaking.s.sol, which does the same thing under Foundry.
 */
const DEFAULT_MIN_STAKE = 1_000_000n; // 1 USDC, 6 decimals
const DEFAULT_REWARD_AMOUNT = 50_000n * 1_000_000n; // 50k USDC
const DEFAULT_DURATION = 365n * 24n * 60n * 60n;

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying SakuStaking with account:", deployer.address);

  const stakingToken = process.env.MOCK_USDC_ADDRESS;
  if (!stakingToken) {
    throw new Error("MOCK_USDC_ADDRESS is required (the token users stake and earn)");
  }

  const minStake = process.env.STAKING_MIN_STAKE
    ? BigInt(process.env.STAKING_MIN_STAKE)
    : DEFAULT_MIN_STAKE;
  const rewardAmount = process.env.STAKING_REWARD_AMOUNT
    ? BigInt(process.env.STAKING_REWARD_AMOUNT)
    : DEFAULT_REWARD_AMOUNT;
  const duration = process.env.STAKING_DURATION_SECONDS
    ? BigInt(process.env.STAKING_DURATION_SECONDS)
    : DEFAULT_DURATION;

  console.log("Staking token:", stakingToken);
  console.log("Minimum stake:", minStake.toString());

  const usdc = await ethers.getContractAt("MockUSDC", stakingToken);
  const held = await usdc.balanceOf(deployer.address);
  if (held < rewardAmount) {
    throw new Error(
      `Deployer holds ${held} of the staking token but the reward pool needs ${rewardAmount}. ` +
        "Fund the deployer or lower STAKING_REWARD_AMOUNT."
    );
  }

  const Staking = await ethers.getContractFactory("SakuStaking");
  const staking = await Staking.deploy(stakingToken, minStake);
  await staking.waitForDeployment();
  const address = await staking.getAddress();

  const approval = await usdc.approve(address, rewardAmount);
  await approval.wait();
  const funding = await staking.fundRewards(rewardAmount, duration);
  await funding.wait();

  console.log("Funded rewards:", rewardAmount.toString(), "over (s):", duration.toString());
  console.log("APY bps (no stakers yet):", (await staking.currentApyBps()).toString());

  console.log("-----------------------------------------");
  console.log(`✅ SakuStaking deployed: ${address}`);
  console.log(`🔗 View on BSCScan: https://testnet.bscscan.com/address/${address}`);
  console.log("-----------------------------------------");
  console.log("\n📋 Add to your web/.env:");
  console.log(`NEXT_PUBLIC_STAKING_ADDRESS=${address}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
