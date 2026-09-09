/**
 * The current user and their wallet, resolved from the session cookie.
 *
 * The browser cannot read `users` or `wallets` directly — both are RLS-on with no permissive
 * policy, and the anon key is deliberately powerless. So identity lookups come through here.
 *
 * This is also where a session is renewed. Every screen calls it on load, so an active user's
 * cookie slides forward and they are never signed out mid-use, while a token copied off a device
 * that then goes quiet dies inside a day. See `lib/session.ts`.
 */

import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { getSession, unauthorized, setSessionCookie, shouldRenew } from '@/lib/session';
import { generateToken } from '@/lib/jwt';

export async function GET(request: Request) {
  const session = await getSession(request);
  if (!session) return unauthorized();

  try {
    const supabase = getSupabaseAdmin();

    const { data: user, error } = await supabase
      .from('users')
      .select('id, phone_hash, display_name, avatar_url, country_code, created_at')
      .eq('id', session.userId)
      .maybeSingle();

    if (error) throw error;
    // `getSession` already refuses a token whose subject is gone, so reaching this is a race
    // with a deletion rather than a stale token. Same answer either way: signed out.
    if (!user) return unauthorized();

    const { data: wallet } = await supabase
      .from('wallets')
      .select('address, chain_id, factors_enrolled')
      .eq('user_id', user.id)
      .eq('chain_id', Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 97))
      .maybeSingle();

    const response = NextResponse.json({
      user,
      wallet: wallet ?? null,
      // A wallet with one factor is one cleared browser away from being unrecoverable, so the
      // UI needs to know the difference between "has a wallet" and "has a safe wallet".
      needsWalletSetup: !wallet,
      needsRecoveryFactor: !wallet || wallet.factors_enrolled < 2,
    });

    if (shouldRenew(session)) {
      const token = await generateToken({
        phoneHash: session.phoneHash,
        userId: session.userId,
        version: session.version,
      });
      return setSessionCookie(response, token);
    }

    return response;
  } catch {
    return NextResponse.json({ error: 'Failed to load account' }, { status: 500 });
  }
}
