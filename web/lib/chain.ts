/**
 * Server-side chain access for the settler wallet.
 *
 * This is the one place Saku holds a private key, and it is deliberately not a user's: the
 * settler is the demo token issuer and the escrow's authorized settler (PRD 5.1 step 5). It can
 * mint MockUSDC and call `settleOfframp`; it cannot touch anyone's wallet, because user funds
 * are controlled by MPC shares this server never sees. Compromising it costs the demo its test
 * tokens, not a user's balance.
 *
 * Everything here is server-only — the runtime guard mirrors `lib/supabaseAdmin.ts`.
 */

import { Contract, JsonRpcProvider, Wallet } from 'ethers';

export const CHAIN_ID = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 97);

/** MockUSDC is 6-decimal, like the USDC it stands in for. */
export const USDC_DECIMALS = 6;

/** Minimal ERC20 surface. MockUSDC's `mint` is open by design — it is a testnet faucet token. */
export const ERC20_ABI = [
  'function mint(address to, uint256 amount) external',
  'function transfer(address to, uint256 amount) external returns (bool)',
  'function balanceOf(address owner) view returns (uint256)',
  'function decimals() view returns (uint8)',
] as const;

function assertServer(): void {
  if (typeof window !== 'undefined') {
    throw new Error('lib/chain.ts must never run in the browser');
  }
}

export function getProvider(): JsonRpcProvider {
  const rpcUrl = process.env.NEXT_PUBLIC_RPC_URL || 'https://bsc-testnet-rpc.publicnode.com';
  // `staticNetwork` skips a chainId round-trip per call, which matters on a serverless route
  // that creates a provider per request.
  return new JsonRpcProvider(rpcUrl, CHAIN_ID, { staticNetwork: true });
}

/**
 * The settler signer.
 *
 * @throws when `SETTLER_PRIVATE_KEY` is unset, rather than falling back to anything. A silent
 *         fallback here would mean topups appear to succeed while crediting nobody.
 */
export function getSettler(): Wallet {
  assertServer();

  const key = process.env.SETTLER_PRIVATE_KEY?.trim();
  if (!key) {
    throw new Error('SETTLER_PRIVATE_KEY is not set — copy it from contract/.env');
  }

  return new Wallet(key.startsWith('0x') ? key : `0x${key}`, getProvider());
}

export function getUsdcAddress(): string {
  const address = process.env.NEXT_PUBLIC_MOCK_USDC_ADDRESS?.trim();
  if (!address) throw new Error('NEXT_PUBLIC_MOCK_USDC_ADDRESS is not set');
  return address;
}

/** MockUSDC bound to the settler, so `transfer` and `mint` are callable. */
export function getUsdcAsSettler(): Contract {
  return new Contract(getUsdcAddress(), ERC20_ABI, getSettler());
}

/**
 * Move `amount` (base units) of USDC from the admin treasury to `to`.
 *
 * A transfer out of the settler's own holdings, not a mint to thin air: the on-chain trace then
 * reads admin -> user, which is what a funded top up actually is. The treasury holds the
 * MockUSDC initial supply; if it ever runs dry it tops itself up first, since MockUSDC's mint
 * is open by design as a testnet faucet token. Minting to the user directly would make every
 * top up look like new supply appearing rather than a payout.
 */
export async function payoutUsdc(to: string, amount: bigint): Promise<{ hash: string; blockNumber: number }> {
  const usdc = getUsdcAsSettler();
  const settler = getSettler();

  const treasury: bigint = await usdc.balanceOf(settler.address);
  if (treasury < amount) {
    const refill = await usdc.mint(settler.address, amount * BigInt(100));
    await refill.wait();
  }

  const tx = await usdc.transfer(to, amount);
  const receipt = await tx.wait();
  return { hash: receipt.hash, blockNumber: receipt.blockNumber };
}
