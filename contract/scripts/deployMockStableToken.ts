import { ethers } from "hardhat";

async function main() {
  console.log("Deploying MockStableToken (mBUSD) to BSC Testnet...");

  const [deployer] = await ethers.getSigners();
  console.log(`Deploying with account: ${deployer.address}`);

  const MockStableToken = await ethers.getContractFactory("MockStableToken");
  const initialSupply = ethers.parseUnits("1000000", 18); // 1 million mBUSD
  const stableToken = await MockStableToken.deploy(initialSupply);

  await stableToken.waitForDeployment();
  const address = await stableToken.getAddress();

  console.log(`✅ MockStableToken deployed to: ${address}`);
  console.log(`🔗 View on BSCScan: https://testnet.bscscan.com/address/${address}`);

  console.log("\n📋 Copy this to your .env file:");
  console.log(`STABLE_TOKEN_ADDRESS=${address}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
