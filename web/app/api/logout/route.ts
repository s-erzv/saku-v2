/**
 * End the session — actually end it, on the server.
 *
 * Signing out used to be `localStorage.removeItem`, which cleared the browser's copy and nothing
 * else. A token already captured stayed valid for its full lifetime, and there was no mechanism
 * anywhere to stop it. Bumping `users.token_version` invalidates every token ever issued to this
 * user, on every device, at once — `lib/session.ts` checks it on every request.
 *
 * That every-device behaviour is the intended trade, not an oversight. Saku is a wallet used from
 * a phone; a sign-out that leaves another session live somewhere the person has forgotten about
 * is the failure mode worth avoiding, and "you have to sign in on your tablet again" is the price.
 *
 * The route answers 200 even when there is no valid session to end. A caller who has been logged
 * out cannot be told "you cannot log out", and the cookie is cleared regardless.
 */

import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { getSession, clearSessionCookie } from '@/lib/session';
import { logAuthEvent } from '@/lib/audit-log';

export async function POST(request: Request) {
  const session = await getSession(request);

  if (session) {
    try {
      const supabase = getSupabaseAdmin();
      // Read-then-write rather than a blind increment: PostgREST has no atomic `col = col + 1`,
      // and a lost update here would leave the old tokens live. The conditional `eq` makes a
      // concurrent sign-out lose the race instead of silently overwriting it, and either way the
      // version has moved, which is all that matters.
      const { data: current } = await supabase
        .from('users')
        .select('token_version')
        .eq('id', session.userId)
        .maybeSingle();

      const next = (current?.token_version ?? session.version) + 1;
      await supabase
        .from('users')
        .update({ token_version: next })
        .eq('id', session.userId)
        .lt('token_version', next);

      await logAuthEvent(request, {
        type: 'session_revoked',
        userId: session.userId,
        phoneHash: session.phoneHash,
        metadata: { newVersion: next },
      });
    } catch (error) {
      // The cookie still gets cleared below. A revocation that failed is worth shouting about —
      // it means a token that the user believes is dead is still live until it expires.
      console.error('[logout] could not bump token_version:', error);
    }
  }

  return clearSessionCookie(NextResponse.json({ success: true }));
}
