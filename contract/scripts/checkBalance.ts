import { ethers } from "hardhat";

async function main() {
  const [signer] = await ethers.getSigners();
  const balance = await ethers.provider.getBalance(signer.address);

  console.log("Wallet:", signer.address);
  console.log("BNB Balance:", ethers.formatEther(balance), "BNB");

  console.log("\n🔗 BSC Testnet Faucet:");
  console.log("  tBNB: https://www.bnbchain.org/en/testnet-faucet");
}

main().catch(console.error);
