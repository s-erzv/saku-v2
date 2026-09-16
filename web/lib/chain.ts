/**
 * Server-side chain access for the settler wallet.
 *
 * This is the one place Saku holds a raw private key, and it is deliberately not a user's: the
 * settler is the demo token issuer and the escrow's authorized settler (PRD 5.1 step 5). It can
 * mint MockUSDC and call `settleOfframp`; it cannot touch anyone's wallet, because user wallets
 * are signed for by the custodian and authorized by a different key entirely (`lib/privy.ts`).
 * Compromising the settler costs the demo its test tokens and its gas faucet, not a user's
 * balance.
 *
 * An earlier version of this note said user funds were controlled by MPC shares this server
 * never sees. That described the Web3Auth integration, which is gone. Saku is custodial; the
 * repository root `README.md` says so under "Custody, stated first".
 *
 * Everything here is server-only — the runtime guard mirrors `lib/supabaseAdmin.ts`.
 */

import {
  Contract,
  JsonRpcProvider,
  Wallet,
  type BlockTag,
  type TransactionRequest,
  type TransactionResponse,
} from 'ethers';
import { allocateNonce, releaseNonces, reserveNonce } from '@/lib/nonce';

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

/** Reused for the life of the instance — see `getProvider`. */
let provider: JsonRpcProvider | null = null;

export function getProvider(): JsonRpcProvider {
  if (provider) return provider;
  const rpcUrl = process.env.NEXT_PUBLIC_RPC_URL || 'https://bsc-testnet-rpc.publicnode.com';
  // `staticNetwork` skips a chainId round-trip per call, which matters on a serverless route
  // that creates a provider per request. Held for the instance rather than rebuilt per call for
  // the same reason: a single top up asks for a provider several times over, and each new one
  // was a fresh TLS handshake to the RPC.
  provider = new JsonRpcProvider(rpcUrl, CHAIN_ID, { staticNetwork: true });
  return provider;
}

/** Nonce collisions, as the common BSC and Geth-family nodes word them. */
function isNonceConflict(error: unknown): boolean {
  const message = (
    (error as { shortMessage?: string; message?: string })?.shortMessage ??
    (error as { message?: string })?.message ??
    ''
  ).toLowerCase();

  return (
    message.includes('nonce too low') ||
    message.includes('nonce is too low') ||
    message.includes('already known') ||
    message.includes('replacement transaction underpriced')
  );
}

/**
 * The settler, signing without paying for a pending nonce it usually does not need.
 *
 * `eth_getTransactionCount(address, "pending")` — which ethers asks for before every transaction —
 * measured 10 to 18 seconds against this RPC, versus about 0.2 seconds for `"latest"`. That cost
 * landed on every top up payout, every packet claim, every gas drip and every off-ramp
 * settlement, and `payoutUsdc` pays it twice whenever the treasury needs refilling first.
 * `lib/nonce.ts` has the measurements and the reasoning.
 *
 * The settler needs one guard the browser wallets do not. A user's wallet is used from one tab at
 * a time, so a local reservation is the whole truth about what is in flight for it. This wallet is
 * shared by every serverless instance at once, and a reservation held in one instance's memory
 * says nothing about what another instance just broadcast — which is the one thing `"pending"` was
 * genuinely buying here, since it reads the mempool.
 *
 * So the fast path is taken optimistically and the slow one is kept for when it is actually
 * needed: if the node rejects the transaction as a nonce collision, the authoritative pending
 * nonce is fetched and the transaction is sent again with it. A collision means the node never
 * accepted this transaction, so re-sending it cannot duplicate anything — the transaction that
 * won the race was a different one, belonging to whichever instance got there first.
 */
class SettlerWallet extends Wallet {
  async getNonce(blockTag?: BlockTag): Promise<number> {
    if (blockTag != null && blockTag !== 'pending') return super.getNonce(blockTag);
    return allocateNonce(getProvider(), CHAIN_ID, this.address);
  }

  async sendTransaction(tx: TransactionRequest): Promise<TransactionResponse> {
    try {
      const sent = await super.sendTransaction(tx);
      reserveNonce(CHAIN_ID, this.address, sent.nonce);
      return sent;
    } catch (error) {
      // Whatever this instance believed about the wallet's nonce, the node has just disagreed.
      releaseNonces(CHAIN_ID, this.address);

      // A caller that chose its own nonce is not asking to be second-guessed.
      if (!isNonceConflict(error) || tx.nonce != null) throw error;

      const nonce = await super.getNonce('pending');
      const sent = await super.sendTransaction({ ...tx, nonce });
      reserveNonce(CHAIN_ID, this.address, sent.nonce);
      return sent;
    }
  }
}

/**
 * The settler signer.
 *
 * @throws when `SETTLER_PRIVATE_KEY` is unset, rather than falling back to anything. A silent
 *         fallback here would mean topups appear to succeed while crediting nobody.
 */
export function getSettler(): SettlerWallet {
  assertServer();

  const key = process.env.SETTLER_PRIVATE_KEY?.trim();
  if (!key) {
    throw new Error('SETTLER_PRIVATE_KEY is not set — copy it from contract/.env');
  }

  return new SettlerWallet(key.startsWith('0x') ? key : `0x${key}`, getProvider());
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
