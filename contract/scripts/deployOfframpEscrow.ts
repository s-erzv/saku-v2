import { ethers } from "hardhat";

/**
 * Deploy SakuOfframpEscrow to BSC Testnet.
 *
 * The PancakeSwap V2 Router and Chainlink BNB/USD feed defaults below are the commonly
 * published BSC Testnet addresses as of this writing. Testnet infrastructure addresses do
 * change over time — verify them before deploying against:
 *   - PancakeSwap: https://docs.pancakeswap.finance/developers/smart-contracts/pancakeswap-exchange/v2-contracts
 *   - Chainlink:   https://docs.chain.link/data-feeds/price-feeds/addresses?network=bnb-chain#BNB%20Testnet
 * Override via env vars if they've moved.
 */
const DEFAULT_PANCAKE_ROUTER_TESTNET = "0xD99D1c33F9fC3444f8101754aBC46c52416550D1";
const DEFAULT_CHAINLINK_BNBUSD_TESTNET = "0x2514895c72f50D8bd4B4F9b1110F0D6bD2c97526";

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying SakuOfframpEscrow with account:", deployer.address);

  const pancakeRouter = process.env.PANCAKE_ROUTER_ADDRESS || DEFAULT_PANCAKE_ROUTER_TESTNET;
  const priceFeed = process.env.CHAINLINK_BNBUSD_FEED || DEFAULT_CHAINLINK_BNBUSD_TESTNET;
  const stableToken = process.env.STABLE_TOKEN_ADDRESS;
  const settler = process.env.SETTLER_ADDRESS || deployer.address;

  if (!stableToken) {
    throw new Error(
      "STABLE_TOKEN_ADDRESS is required (a BUSD-pegged testnet token, or your own MockStableToken deployment)"
    );
  }

  console.log("PancakeSwap Router:", pancakeRouter);
  console.log("Chainlink BNB/USD Feed:", priceFeed);
  console.log("Stable settlement token:", stableToken);
  console.log("Settler (backend relayer):", settler);

  const Escrow = await ethers.getContractFactory("SakuOfframpEscrow");
  const escrow = await Escrow.deploy(pancakeRouter, priceFeed, stableToken, settler);
  await escrow.waitForDeployment();

  const address = await escrow.getAddress();
  console.log("-----------------------------------------");
  console.log(`✅ SakuOfframpEscrow deployed: ${address}`);
  console.log(`🔗 View on BSCScan: https://testnet.bscscan.com/address/${address}`);
  console.log("-----------------------------------------");
  console.log("\n📋 Add to your web/.env:");
  console.log(`NEXT_PUBLIC_SAKU_ESCROW_ADDRESS=${address}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
