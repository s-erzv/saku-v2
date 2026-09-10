/**
 * Get-or-create a user's wallet with the custodian (replaces `/api/mpc/id-token`).
 *
 * The caller must already hold a Saku session token, issued only after the WhatsApp OTP check
 * in `/api/verify-otp` — so possession of the phone number is what gates a wallet coming into
 * existence at all, same as before. What changed is what happens after that gate: instead of
 * minting a token for the browser to hand to Web3Auth, this creates (once) or looks up (every
 * time after) the account with the custodian and returns the address directly. No further round
 * trip to a third party happens in the browser.
 */

import { NextResponse } from 'next/server';
import { getSession, unauthorized } from '@/lib/session';
import { createUserWallet } from '@/lib/privy';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { ensureGasFor } from '@/lib/gas';
import { CHAIN_ID } from '@/lib/chain';
import { checkRateLimit, RATE_LIMITS } from '@/lib/rate-limiter';
import { clientKey } from '@/lib/request-meta';
import { logAuthEvent } from '@/lib/audit-log';

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
      const gas = await ensureGasFor(session.userId, existing.address);
      return NextResponse.json({ address: existing.address, gas: gas.status });
    }

    // A wallet row can already exist from an earlier custody model — Web3Auth-era (verifier =
    // 'saku-phone-otp') or the custody model before this one, which now shows up simply as a
    // row with no `privy_wallet_id`, its own columns having been dropped once nothing read them.
    // Creating a fresh Privy wallet and overwriting the row is a deliberate cutover, not an
    // oversight: the old key material is held by a provider this app no longer calls, so the
    // address it derived cannot be signed for any more. On testnet the balance is re-mintable;
    // see docs/mpc-setup.md.
    const wallet = await createUserWallet(session.phoneHash);

    const { data, error } = await supabase
      .from('wallets')
      .upsert(
        {
          user_id: session.userId,
          address: wallet.address,
          chain_id: CHAIN_ID,
          verifier: 'privy',
          verifier_id: session.phoneHash,
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

    const gas = await ensureGasFor(session.userId, wallet.address);
    return NextResponse.json({ address: data.address, gas: gas.status });
  } catch (err) {
    console.error('[mpc/provision] failed:', err);
    return NextResponse.json({ error: 'Failed to provision wallet' }, { status: 500 });
  }
}
