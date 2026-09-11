/**
 * Get-or-create a user's wallet with the custodian (replaces `/api/mpc/id-token`).
 *
 * The caller must already hold a Saku session token, issued only after the WhatsApp OTP check
 * in `/api/verify-otp` — so possession of the phone number is what gates a wallet coming into
 * existence at all, same as before. What changed is what happens after that gate: instead of
 * minting a token for the browser to hand to Web3Auth, this creates (once) or looks up (every
 * time after) the account with the custodian and returns the address directly. No further round
 * trip to a third party happens in the browser.
 *
 * Gas is topped up after the response, not before it. The address is all the sign-in screen is
 * waiting for, and a drip means sending a transaction and waiting for it to be mined — seconds of
 * "Setting up your wallet" on a new account, and an RPC balance check on every sign-in after. The
 * one thing that needs the gas, a first transfer, cannot happen in those seconds anyway: a new
 * wallet has nothing to send yet.
 *
 * The reply names the account the address belongs to, so the browser can file it under that
 * account and never show it to whoever signs in next on the same device.
 */

import { createHash } from 'node:crypto';
import { after, NextResponse } from 'next/server';
import { getSession, unauthorized } from '@/lib/session';
import { createUserWallet } from '@/lib/privy';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { ensureGasFor } from '@/lib/gas';
import { CHAIN_ID } from '@/lib/chain';
import { checkRateLimit, RATE_LIMITS } from '@/lib/rate-limiter';
import { clientKey } from '@/lib/request-meta';
import { logAuthEvent } from '@/lib/audit-log';

/**
 * `ensureGasFor` never throws, so a drip that did not happen would otherwise vanish. Only the
 * outcomes someone can act on are logged — a capped or already-funded wallet is working as meant.
 */
function topUpGasLater(userId: string, address: string) {
  after(async () => {
    const gas = await ensureGasFor(userId, address);
    if (gas.status === 'failed' || gas.status === 'settler_low') {
      console.error('[mpc/provision] gas top-up did not go out:', gas);
    }
  });
}

/**
 * What goes in `wallets.verifier_id`: a 32-byte hash of the user id.
 *
 * It used to be the phone hash. `(verifier, verifier_id, chain_id)` is unique, and a recovered
 * account's row keeps its old number's hash, so nobody could ever get a wallet on a number that
 * had been recovered away from. The column only has to be distinct per account — nothing reads
 * it — and a user id always is. Hashed rather than stored raw because the column is the `hash32`
 * domain, which accepts `0x` and 64 hex characters and nothing else.
 */
function walletVerifierId(userId: string): string {
  return `0x${createHash('sha256').update(`saku-wallet:${userId}`).digest('hex')}`;
}

export async function POST(request: Request) {
  const session = await getSession(request);
  if (!session) return unauthorized();

  const limit = await checkRateLimit(clientKey(request, 'provision'), RATE_LIMITS.IP_BASED);
  if (!limit.allowed) {
    return NextResponse.json({ error: 'Too many requests from your device.' }, { status: 429 });
  }

  try {
    const supabase = getSupabaseAdmin();

    const { data: existing } = await supabase
      .from('wallets')
      .select('address, privy_wallet_id')
      .eq('user_id', session.userId)
      .eq('chain_id', CHAIN_ID)
      .maybeSingle();

    if (existing?.privy_wallet_id && existing.address) {
      topUpGasLater(session.userId, existing.address);
      return NextResponse.json({ address: existing.address, userId: session.userId });
    }

    // A wallet row can already exist from an earlier custody model — Web3Auth-era (verifier =
    // 'saku-phone-otp') or the custody model before this one, which now shows up simply as a
    // row with no `privy_wallet_id`, its own columns having been dropped once nothing read them.
    // Creating a fresh Privy wallet and overwriting the row is a deliberate cutover, not an
    // oversight: the old key material is held by a provider this app no longer calls, so the
    // address it derived cannot be signed for any more. On testnet the balance is re-mintable;
    // see docs/mpc-setup.md.
    const wallet = await createUserWallet(session.userId);

    // A custodial wallet another Saku account already holds is never bound to this one, whatever
    // the custodian returned. `createUserWallet` adopts an existing wallet when its external id is
    // taken, and while those ids were phone hashes, an account registered on a recovered number
    // was offered the recovered account's wallet this way. Keying by user id closed that path;
    // this check is what keeps any future path like it from reaching someone else's money.
    const { data: holder, error: holderError } = await supabase
      .from('wallets')
      .select('user_id')
      .or(`privy_wallet_id.eq.${wallet.walletId},address.eq.${wallet.address}`)
      .neq('user_id', session.userId)
      .limit(1)
      .maybeSingle();

    if (holderError) throw holderError;
    if (holder) {
      console.error('[mpc/provision] refused a wallet already held by another account', {
        userId: session.userId,
        walletId: wallet.walletId,
      });
      return NextResponse.json({ error: 'Failed to provision wallet' }, { status: 500 });
    }

    const { data, error } = await supabase
      .from('wallets')
      .upsert(
        {
          user_id: session.userId,
          address: wallet.address,
          chain_id: CHAIN_ID,
          verifier: 'privy',
          verifier_id: walletVerifierId(session.userId),
          privy_wallet_id: wallet.walletId,
          factors_enrolled: 1,
          // A new Privy wallet is a different on-chain account with zero drip history of its
          // own — without resetting these, a row left by either earlier custody model
          // hands the new address someone else's drip count and cooldown,
          // capping a wallet that has never actually received gas.
          gas_drip_count: 0,
          last_gas_drip_at: null,
        },
        { onConflict: 'user_id,chain_id' }
      )
      .select('address')
      .single();

    if (error) throw error;

    // A wallet coming into existence is a once-per-account event and the moment an address starts
    // being able to hold money. Worth a row on its own.
    await logAuthEvent(request, {
      type: 'wallet_provisioned',
      userId: session.userId,
      phoneHash: session.phoneHash,
      metadata: { address: data.address },
    });

    topUpGasLater(session.userId, data.address);
    return NextResponse.json({ address: data.address, userId: session.userId });
  } catch (err) {
    console.error('[mpc/provision] failed:', err);
    return NextResponse.json({ error: 'Failed to provision wallet' }, { status: 500 });
  }
}
