/**
 * The current user and their wallet, resolved from the session token.
 *
 * The browser cannot read `users` or `wallets` directly — both are RLS-on with no permissive
 * policy, and the anon key is deliberately powerless. So identity lookups come through here,
 * where the session token is actually verified.
 */

import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { verifyToken, extractTokenFromHeader } from '@/lib/jwt';

export async function GET(request: Request) {
  const sessionToken = extractTokenFromHeader(request.headers.get('authorization'));
  if (!sessionToken) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let session;
  try {
    session = await verifyToken(sessionToken);
  } catch {
    return NextResponse.json({ error: 'Invalid or expired session' }, { status: 401 });
  }

  try {
    const supabase = getSupabaseAdmin();

    const { data: user, error } = await supabase
      .from('users')
      .select('id, phone_hash, display_name, avatar_url, country_code, created_at')
      .eq('id', session.userId)
      .maybeSingle();

    if (error) throw error;
    // The token verified, but its subject is gone — a deleted account, or a token minted
    // against a database that has since been replaced. Treat it as logged out.
    if (!user) return NextResponse.json({ error: 'User no longer exists' }, { status: 401 });

    const { data: wallet } = await supabase
      .from('wallets')
      .select('address, chain_id, factors_enrolled')
      .eq('user_id', user.id)
      .eq('chain_id', Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 97))
      .maybeSingle();

    return NextResponse.json({
      user,
      wallet: wallet ?? null,
      // A wallet with one factor is one cleared browser away from being unrecoverable, so the
      // UI needs to know the difference between "has a wallet" and "has a safe wallet".
      needsWalletSetup: !wallet,
      needsRecoveryFactor: !wallet || wallet.factors_enrolled < 2,
    });
  } catch {
    return NextResponse.json({ error: 'Failed to load account' }, { status: 500 });
  }
}
