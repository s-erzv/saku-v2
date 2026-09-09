/**
 * Wallet custody and signing, on Privy.
 *
 * Replaced `lib/turnkey.ts`, which has since been deleted — a configured but unreferenced signer
 * is a live key for a provider nothing calls. The move was forced by economics rather than
 * architecture: Turnkey's free tier allows 25 signatures a month, and a single user sending a few
 * transfers exhausts it. Privy allows 50,000.
 *
 * **This is custodial, and the product copy says so.** The private key never exists inside this
 * application and cannot be extracted from the provider — but the authority to use it lives here,
 * which means Saku's server can sign for any user's wallet whenever it decides to. Calling that
 * "non-custodial" because the bytes sit elsewhere would be a distinction that matters to nobody
 * whose money it is.
 *
 * Two things authorize a signature, and both are needed:
 *   - `PRIVY_APP_SECRET`, which authenticates the app to Privy's API, and
 *   - `PRIVY_AUTHORIZATION_KEY`, a P-256 private key held only here, which signs each wallet
 *     request. Privy holds its public half, never the private one.
 *
 * That is deliberate. A leaked app secret on its own moves no money.
 *
 * What decides *whether* to ask for a signature is not here: `lib/tx-policy.ts` vets the
 * transaction, `lib/spend-limits.ts` caps the daily total, and `/api/mpc/sign` records every
 * decision. This module only carries out one that has already been made.
 */

import { PrivyClient } from '@privy-io/node';
import { Transaction, getAddress } from 'ethers';
import { SignerQuotaError, SignerUnreachableError, isConnectionFailure } from '@/lib/signer-errors';

function readEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

let clientSingleton: PrivyClient | null = null;

function client(): PrivyClient {
  if (clientSingleton) return clientSingleton;
  clientSingleton = new PrivyClient({
    appId: readEnv('PRIVY_APP_ID'),
    appSecret: readEnv('PRIVY_APP_SECRET'),
  });
  return clientSingleton;
}

/**
 * The dashboard hands this key out with a `wallet-auth:` prefix, which is a label rather than
 * part of the key. Stripping it here means the env var can be pasted exactly as copied.
 */
function authorizationKey(): string {
  return readEnv('PRIVY_AUTHORIZATION_KEY').replace(/^wallet-auth:/, '');
}

/** Every wallet request is signed with the authorization key; nothing moves without it. */
function authorizationContext() {
  return { authorization_private_keys: [authorizationKey()] };
}

export interface PrivyWallet {
  walletId: string;
  address: string;
}

/**
 * Provision a wallet for one user.
 *
 * `owner_id` makes this app's authorization key the wallet's owner, so only a request signed
 * with that key can ever move funds. `external_id` carries the caller's phone hash — the same
 * identifier the rest of the schema is keyed by — which makes a Privy wallet traceable back to a
 * Saku user without a phone number existing on either side.
 */
export async function createUserWallet(phoneHash: string): Promise<PrivyWallet> {
  // `external_id` allows [a-zA-Z0-9_-] up to 64 characters; a keccak hash without its `0x` is
  // exactly 64 hex characters.
  const externalId = phoneHash.replace(/^0x/, '').slice(0, 64);

  try {
    const wallet = await client().wallets().create({
      chain_type: 'ethereum',
      owner_id: readEnv('PRIVY_AUTHORIZATION_KEY_ID'),
      external_id: externalId,
    });

    return toWallet(wallet.id, wallet.address);
  } catch (error) {
    if (isConnectionFailure(error)) throw new SignerUnreachableError();

    /**
     * `external_id` is write-once and unique per app, so a wallet created here and then lost —
     * because the database write after it failed, or the request timed out on the way back —
     * would make every future attempt fail forever with "already exists". Provisioning runs
     * before a database write and therefore has to be safe to retry, so a taken id is resolved
     * by adopting the wallet that already holds it rather than treating it as an error.
     */
    if (isDuplicateExternalId(error)) {
      const existing = await findWalletByExternalId(externalId);
      if (existing) {
        console.warn('[privy] adopting the wallet already registered for this user');
        return existing;
      }
    }

    throw error;
  }
}

/**
 * The `evm_address` domain in Postgres stores addresses lowercase, and every other address in
 * the schema is written that way. Privy returns EIP-55 checksummed.
 */
function toWallet(walletId: string, address: string): PrivyWallet {
  return { walletId, address: getAddress(address).toLowerCase() };
}

function isDuplicateExternalId(error: unknown): boolean {
  const message = (error as { message?: string })?.message ?? '';
  return /external_id already exists/i.test(message);
}

async function findWalletByExternalId(externalId: string): Promise<PrivyWallet | null> {
  const page = await client().wallets().list({ external_id: externalId, chain_type: 'ethereum' });
  const wallet = page.data?.[0];
  return wallet ? toWallet(wallet.id, wallet.address) : null;
}

/** Privy's gRPC-style code 8, or its message, both mean the plan's signing allowance is spent. */
function isQuotaError(error: unknown): boolean {
  const e = error as { code?: number | string; status?: number; message?: string };
  return (
    e?.code === 8 ||
    e?.status === 429 ||
    /over its allotted quota|resource exhausted|quota/i.test(e?.message ?? '')
  );
}

/**
 * Sign an already-built transaction.
 *
 * The caller passes the RLP-serialized *unsigned* transaction, which is the shape Turnkey took
 * and therefore the shape the client already sends (`hooks/useMpcWallet.tsx`). Privy wants the
 * fields instead, so they are parsed back out here rather than changing the client's contract —
 * the browser has no business knowing which signing provider is behind this route.
 *
 * Nothing is broadcast. The signature comes back, the client sends it.
 */
export async function signWithWallet(
  walletId: string,
  address: string,
  unsignedTransactionHex: string
): Promise<string> {
  const tx = Transaction.from(
    unsignedTransactionHex.startsWith('0x') ? unsignedTransactionHex : `0x${unsignedTransactionHex}`
  );

  const hex = (value: bigint | null | undefined) => `0x${(value ?? BigInt(0)).toString(16)}`;

  // Type 2 (EIP-1559) and type 0 (legacy) price gas differently, and sending the wrong pair
  // produces a signature over a transaction the chain will not accept.
  const gas =
    tx.type === 2
      ? {
          max_fee_per_gas: hex(tx.maxFeePerGas),
          max_priority_fee_per_gas: hex(tx.maxPriorityFeePerGas),
        }
      : { gas_price: hex(tx.gasPrice) };

  const transaction = {
    to: tx.to ?? undefined,
    value: hex(tx.value),
    data: tx.data && tx.data !== '0x' ? tx.data : undefined,
    nonce: tx.nonce,
    gas_limit: hex(tx.gasLimit),
    chain_id: Number(tx.chainId),
    type: (tx.type ?? 2) as 0 | 2,
    ...gas,
  };

  /**
   * Retried once, and only when the request never reached Privy.
   *
   * Safe to repeat: this signs and does not broadcast, and the transaction carries a fixed
   * nonce, so even two valid signatures of it can only ever produce one mined transaction.
   * Failing a payment because one TLS handshake was slow is the worse outcome.
   */
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const result = await client()
        .wallets()
        .ethereum()
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .signTransaction(walletId, {
          params: { transaction: transaction as never },
          authorization_context: authorizationContext(),
        });

      const signed = result.signed_transaction;

      // The signature is only useful if it belongs to the wallet this session owns. Checking it
      // here turns a silent mis-signature into a failed request, and costs one ecrecover.
      const recovered = Transaction.from(signed).from;
      if (!recovered || getAddress(recovered) !== getAddress(address)) {
        throw new Error('Privy returned a signature for a different address');
      }

      return signed.startsWith('0x') ? signed : `0x${signed}`;
    } catch (error) {
      lastError = error;
      if (isQuotaError(error)) throw new SignerQuotaError();
      if (!isConnectionFailure(error)) throw error;
      if (attempt === 0) {
        console.warn('[privy] could not reach the API; retrying once');
        await new Promise((resolve) => setTimeout(resolve, 400));
      }
    }
  }

  console.error('[privy] unreachable after a retry:', lastError);
  throw new SignerUnreachableError();
}
