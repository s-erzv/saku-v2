import { ethers } from "hardhat";

/**
 * Seed the PancakeSwap Testnet pair that `settleOfframp` swaps through.
 *
 * Without this, the router has no `lockedToken -> stableToken` pair and every settlement
 * reverts inside PancakeSwap while lock/refund keep working — so the escrow looks broken when
 * it is only missing liquidity. Run once after deploying the mock tokens.
 *
 * Env: MOCK_USDC_ADDRESS, STABLE_TOKEN_ADDRESS, PANCAKE_ROUTER_ADDRESS.
 */
const ROUTER_ABI = [
  "function factory() view returns (address)",
  "function addLiquidity(address tokenA, address tokenB, uint256 amountADesired, uint256 amountBDesired, uint256 amountAMin, uint256 amountBMin, address to, uint256 deadline) returns (uint256, uint256, uint256)",
  "function getAmountsOut(uint256 amountIn, address[] path) view returns (uint256[])",
];
const FACTORY_ABI = ["function getPair(address, address) view returns (address)"];
const ERC20_ABI = [
  "function approve(address, uint256) returns (bool)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
  "function balanceOf(address) view returns (uint256)",
];

/** Units of each side to deposit, priced 1:1 — enough depth that demo-sized locks barely move it. */
const LIQUIDITY_UNITS = 100_000n;

async function main() {
  const [signer] = await ethers.getSigners();

  const tokenAddress = process.env.MOCK_USDC_ADDRESS;
  const stableAddress = process.env.STABLE_TOKEN_ADDRESS;
  const routerAddress = process.env.PANCAKE_ROUTER_ADDRESS;
  if (!tokenAddress || !stableAddress || !routerAddress) {
    throw new Error("MOCK_USDC_ADDRESS, STABLE_TOKEN_ADDRESS and PANCAKE_ROUTER_ADDRESS are required");
  }

  const router = new ethers.Contract(routerAddress, ROUTER_ABI, signer);
  const token = new ethers.Contract(tokenAddress, ERC20_ABI, signer);
  const stable = new ethers.Contract(stableAddress, ERC20_ABI, signer);

  const factory = new ethers.Contract(await router.factory(), FACTORY_ABI, signer);
  const existingPair = await factory.getPair(tokenAddress, stableAddress);
  if (existingPair !== ethers.ZeroAddress) {
    console.log(`Pair already exists at ${existingPair} — adding more liquidity to it.`);
  }

  const tokenAmount = LIQUIDITY_UNITS * 10n ** BigInt(await token.decimals());
  const stableAmount = LIQUIDITY_UNITS * 10n ** BigInt(await stable.decimals());

  for (const [erc20, amount, label] of [
    [token, tokenAmount, await token.symbol()],
    [stable, stableAmount, await stable.symbol()],
  ] as const) {
    const balance = await erc20.balanceOf(signer.address);
    if (balance < amount) {
      throw new Error(`Not enough ${label}: have ${balance}, need ${amount}`);
    }
    console.log(`Approving router for ${LIQUIDITY_UNITS} ${label}...`);
    await (await erc20.approve(routerAddress, amount)).wait();
  }

  console.log("Adding liquidity...");
  const deadline = Math.floor(Date.now() / 1000) + 20 * 60;
  const tx = await router.addLiquidity(
    tokenAddress,
    stableAddress,
    tokenAmount,
    stableAmount,
    0,
    0,
    signer.address,
    deadline
  );
  const receipt = await tx.wait();

  const pair = await factory.getPair(tokenAddress, stableAddress);
  console.log("-----------------------------------------");
  console.log(`✅ Liquidity added in ${receipt?.hash}`);
  console.log(`🔗 Pair: https://testnet.bscscan.com/address/${pair}`);

  const probe = 10n * 10n ** BigInt(await token.decimals());
  const [, out] = await router.getAmountsOut(probe, [tokenAddress, stableAddress]);
  console.log(`Quote: 10 ${await token.symbol()} -> ${ethers.formatUnits(out, await stable.decimals())} ${await stable.symbol()}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
