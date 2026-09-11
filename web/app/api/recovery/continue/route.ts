/**
 * The link from the second recovery email, sent once a majority of guardians has approved.
 *
 * It trades the token in the URL for an httpOnly cookie scoped to the recovery API, then sends the
 * browser on to the screen that asks for the new number. The token is out of the address bar
 * before any page renders, so it is not left in history and no script on the page can read it.
 * See `lib/recovery-ticket.ts`.
 *
 * Opening it does not use it up. The link stays good until the recovery finishes or its 24 hours
 * run out, so switching devices or losing the tab halfway costs nothing.
 */

import { NextResponse } from 'next/server';

import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { hashToken, tokenMatches } from '@/lib/email';
import { recoveryStage, type RecoveryRequestRow } from '@/lib/recovery';
import { setRecoveryTicket } from '@/lib/recovery-ticket';
import { appOrigin } from '@/lib/app-url';

function recoverUrl(request: Request, stage: string, extra = ''): string {
  return `${appOrigin(request)}/recover?stage=${stage}${extra}`;
}

export async function GET(request: Request) {
  const token = new URL(request.url).searchParams.get('token');
  if (!token) return NextResponse.redirect(recoverUrl(request, 'invalid'));

  try {
    const supabase = getSupabaseAdmin();

    const { data: recovery } = await supabase
      .from('recovery_requests')
      .select('id, status, email_verified_at, guardian_approved_at, expires_at, finish_token_hash')
      .eq('finish_token_hash', hashToken(token))
      .maybeSingle();

    // A finished recovery clears its hash, so a used link lands here too.
    if (!recovery?.finish_token_hash || !tokenMatches(token, recovery.finish_token_hash)) {
      return NextResponse.redirect(recoverUrl(request, 'invalid'));
    }

    const stage = recoveryStage(recovery as RecoveryRequestRow);
    if (stage !== 'choose_number') {
      return NextResponse.redirect(
        recoverUrl(request, stage === 'rejected' || stage === 'expired' ? stage : 'invalid')
      );
    }

    // So the last screen can say how many people vouched, rather than "a guardian" when it was two.
    const { count } = await supabase
      .from('recovery_request_guardians')
      .select('guardian_id', { count: 'exact', head: true })
      .eq('recovery_request_id', recovery.id)
      .not('approved_at', 'is', null);

    return setRecoveryTicket(
      NextResponse.redirect(recoverUrl(request, 'choose_number', `&confirmed=${count ?? 0}`)),
      token,
      new Date(recovery.expires_at)
    );
  } catch {
    return NextResponse.redirect(recoverUrl(request, 'failed'));
  }
}
