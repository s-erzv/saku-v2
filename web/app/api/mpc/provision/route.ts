/**
 * Get-or-create a user's wallet on Turnkey (replaces `/api/mpc/id-token`, see docs/mpc-setup.md).
 *
 * The caller must already hold a Saku session token, issued only after the WhatsApp OTP check
 * in `/api/verify-otp` — so possession of the phone number is what gates a wallet coming into
 * existence at all, same as before. What changed is what happens after that gate: instead of
 * minting a token for the browser to hand to Web3Auth, this creates (once) or looks up (every
 * time after) a Turnkey sub-organization and returns the address directly. No further round
 * trip to a third party happens in the browser.
 */

import { NextResponse } from 'next/server';
import { verifyToken, extractTokenFromHeader } from '@/lib/jwt';
import { createUserWallet } from '@/lib/turnkey';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { ensureGasFor } from '@/lib/gas';
import { CHAIN_ID } from '@/lib/chain';
import { rateLimiter, RATE_LIMITS } from '@/lib/rate-limiter';
import { extractClientIP } from '@/lib/auth-middleware';

export async function POST(request: Request) {
  const sessionToken = extractTokenFromHeader(request.headers.get('authorization'));
  if (!sessionToken) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let session;
  try {
    session = await verifyToken(sessionToken);
  } catch {
    return NextResponse.json({ error: 'Invalid or expired session' }, { status: 401 });
  }

  const clientIP = extractClientIP(request) || 'unknown';
  const ipRateLimit = rateLimiter.check(`ip:${clientIP}`, RATE_LIMITS.IP_BASED);
  if (!ipRateLimit.allowed) {
    return NextResponse.json({ error: 'Too many requests from your device.' }, { status: 429 });
  }

  try {
    const supabase = getSupabaseAdmin();

    const { data: existing } = await supabase
      .from('wallets')
      .select('address, turnkey_sub_org_id, turnkey_wallet_id')
      .eq('user_id', session.userId)
      .eq('chain_id', CHAIN_ID)
      .maybeSingle();

    if (existing?.turnkey_sub_org_id && existing.address) {
      const gas = await ensureGasFor(session.userId, existing.address);
      return NextResponse.json({ address: existing.address, gas: gas.status });
    }

    // A wallet row can already exist from before this migration (Web3Auth-era: verifier =
    // 'saku-phone-otp', no turnkey_sub_org_id). Creating a fresh Turnkey wallet and overwriting
    // it is a deliberate cutover, not an oversight — see docs/mpc-setup.md for why old
    // Web3Auth-derived addresses are abandoned rather than migrated.
    const wallet = await createUserWallet(session.phoneHash);

    const { data, error } = await supabase
      .from('wallets')
      .upsert(
        {
          user_id: session.userId,
          address: wallet.address,
          chain_id: CHAIN_ID,
          verifier: 'turnkey',
          verifier_id: session.phoneHash,
          turnkey_sub_org_id: wallet.subOrgId,
          turnkey_wallet_id: wallet.walletId,
          factors_enrolled: 1,
          // A new Turnkey wallet is a different on-chain account with zero drip history of its
          // own — without resetting these, a row that already existed (Web3Auth-era, or an
          // earlier Turnkey wallet) hands the new address someone else's drip count and cooldown,
          // capping a wallet that has never actually received gas.
          gas_drip_count: 0,
          last_gas_drip_at: null,
        },
        { onConflict: 'user_id,chain_id' }
      )
      .select('address')
      .single();

    if (error) throw error;

    const gas = await ensureGasFor(session.userId, wallet.address);
    return NextResponse.json({ address: data.address, gas: gas.status });
  } catch (err) {
    console.error('[mpc/provision] failed:', err);
    return NextResponse.json({ error: 'Failed to provision wallet' }, { status: 500 });
  }
}
