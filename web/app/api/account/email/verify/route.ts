/**
 * The link from the confirmation email.
 *
 * No session is required and none is available — the message is read in a mail client, often on
 * a different device. The token is the proof, and it proves exactly one thing: whoever opened
 * this controls the inbox. That is the entire claim being made, and it is the claim the backup
 * email is for.
 *
 * What the token cannot do is start anything. It only completes a change the signed-in account
 * owner already requested, so an intercepted link grants an attacker nothing they did not
 * already have.
 */

import { NextResponse } from 'next/server';

import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { hashToken, tokenMatches } from '@/lib/email';
import { logAuthEvent } from '@/lib/audit-log';
import { appOrigin } from '@/lib/app-url';

function settingsUrl(request: Request, outcome: string): string {
  return `${appOrigin(request)}/profile/security?email=${outcome}`;
}

export async function GET(request: Request) {
  const token = new URL(request.url).searchParams.get('token');
  if (!token) return NextResponse.redirect(settingsUrl(request, 'invalid'));

  try {
    const supabase = getSupabaseAdmin();

    // Looked up by hash, then compared in constant time. The lookup alone would be enough for
    // correctness; the comparison is what keeps a partial match from being measurable.
    const { data: change } = await supabase
      .from('pending_changes')
      .select('id, user_id, new_value_hash, new_value_ciphertext, verify_token_hash, verify_expires_at')
      .eq('verify_token_hash', hashToken(token))
      .eq('change_type', 'email')
      .is('applied_at', null)
      .is('cancelled_at', null)
      .maybeSingle();

    if (!change?.verify_token_hash || !tokenMatches(token, change.verify_token_hash)) {
      return NextResponse.redirect(settingsUrl(request, 'invalid'));
    }

    if (change.verify_expires_at && new Date(change.verify_expires_at).getTime() <= Date.now()) {
      return NextResponse.redirect(settingsUrl(request, 'expired'));
    }

    const now = new Date().toISOString();

    // The address lands on `users` only here. Until this moment it was a claim; `email_hash`
    // means an address this account has demonstrably received mail at, and nothing weaker.
    const { error: applyError } = await supabase
      .from('users')
      .update({
        email_hash: change.new_value_hash,
        email_ciphertext: change.new_value_ciphertext,
        email_verified_at: now,
        updated_at: now,
      })
      .eq('id', change.user_id);

    if (applyError) throw applyError;

    // Burned after use, so the link in an inbox that is later compromised is inert.
    await supabase
      .from('pending_changes')
      .update({ verified_at: now, applied_at: now, updated_at: now })
      .eq('id', change.id);

    await logAuthEvent(request, {
      type: 'backup_email_verified',
      userId: change.user_id,
    });

    return NextResponse.redirect(settingsUrl(request, 'verified'));
  } catch {
    return NextResponse.redirect(settingsUrl(request, 'failed'));
  }
}
