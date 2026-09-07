import { ethers } from "hardhat";

async function main() {
  console.log("Deploying Mock USDC to BSC Testnet...");

  const [deployer] = await ethers.getSigners();
  console.log(`Deploying with account: ${deployer.address}`);

  const MockUSDC = await ethers.getContractFactory("MockUSDC");

  // Mint 1 million USDC initial supply (1,000,000 * 10^6 = 1,000,000,000,000)
  const initialSupply = ethers.parseUnits("1000000", 6); // 1 million USDC
  const mockUSDC = await MockUSDC.deploy(initialSupply);

  await mockUSDC.waitForDeployment();
  const address = await mockUSDC.getAddress();

  console.log(`✅ Mock USDC deployed to: ${address}`);
  console.log(`📝 Token Name: USD Coin`);
  console.log(`📝 Token Symbol: USDC`);
  console.log(`📝 Decimals: 6`);
  console.log(`📝 Max Supply: 10,000,000 USDC`);

  // Get deployer balance
  const balance = await mockUSDC.balanceOf(deployer.address);
  console.log(`💰 Deployer balance: ${ethers.formatUnits(balance, 6)} USDC`);

  console.log("\n📋 Copy this to your .env file:");
  console.log(`NEXT_PUBLIC_USDC_TOKEN_ADDRESS=${address}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
