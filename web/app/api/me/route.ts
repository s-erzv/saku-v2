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
import {
  hasRecoveryPath,
  isGuardianEligible,
  isRecoveryReady,
  nextGuardianActiveAt,
  type GuardianRow,
} from '@/lib/guardians';
import { getSession, unauthorized, setSessionCookie, shouldRenew } from '@/lib/session';
import { generateToken } from '@/lib/jwt';

export async function GET(request: Request) {
  const session = await getSession(request);
  if (!session) return unauthorized();

  try {
    const supabase = getSupabaseAdmin();

    // Two column lists, one query in the normal case. `phone_dial_code` and `phone_last4`
    // arrive with `db/migrations/2026-09-11-phone-hint.sql`, and this route is the backbone of
    // every screen — selecting a column that does not exist yet would not degrade the profile
    // screen, it would sign everybody out. So a database still missing them falls back to the
    // list without, and the profile screen shows what it showed before.
    const BASE_COLUMNS = 'id, phone_hash, display_name, avatar_url, country_code, created_at, email_verified_at';

    let { data: user, error } = await supabase
      .from('users')
      .select(`${BASE_COLUMNS}, phone_dial_code, phone_last4`)
      .eq('id', session.userId)
      .maybeSingle();

    if (error) {
      ({ data: user, error } = await supabase
        .from('users')
        .select(BASE_COLUMNS)
        .eq('id', session.userId)
        .maybeSingle());
    }

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

    // What "recoverable" means, asked of the two things that actually decide it.
    //
    // This used to be `wallet.factors_enrolled < 2`, which was always true: the column is
    // written as 1 when the wallet is provisioned and nothing has ever incremented it. It was a
    // leftover from the Web3Auth threshold-share model, where a second factor was a key share
    // the user held. Under server-side custody there is no such share, so the flag measured
    // nothing and no screen read it.
    const { data: guardianRows } = await supabase
      .from('guardians')
      .select('id, status, approved_at, effective_at')
      .eq('user_id', user.id)
      .neq('status', 'revoked');

    const guardians = (guardianRows ?? []) as GuardianRow[];
    const emailVerified = !!user.email_verified_at;
    const now = Date.now();
    const nextActive = nextGuardianActiveAt(guardians, now);

    const response = NextResponse.json({
      user,
      wallet: wallet ?? null,
      needsWalletSetup: !wallet,
      recovery: {
        emailVerified,
        // Approved and past its cooling period. A guardian who accepted an hour ago is real but
        // cannot help yet, and saying otherwise would be the one lie this screen must not tell.
        activeGuardians: guardians.filter((g) => isGuardianEligible(g, now)).length,
        pendingGuardians: guardians.filter((g) => !isGuardianEligible(g, now)).length,
        // Both factors in place — the same test the recovery screen applies before sending
        // anything, so a badge built on this cannot say "on" while a recovery would be refused.
        ready: isRecoveryReady({ emailVerified, guardians, nowMs: now }),
        // Remaining rather than a timestamp, so the screen can say "in 5 hours" without reading
        // the clock during render.
        guardianReadyInMs: nextActive ? nextActive.getTime() - now : null,
      },
      // Kept under the old name so existing callers keep compiling. True only when the account
      // has neither factor; `recovery.ready` is the question "would a recovery work today".
      needsRecoveryFactor: !hasRecoveryPath({ emailVerified, guardians, nowMs: now }),
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
