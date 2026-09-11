/**
 * A guardian answering the invitation addressed to them.
 *
 * Only the invited person can act, and only on an invitation that is still open. The owner
 * cannot approve on their behalf — an owner-approved guardian is not a second human, it is the
 * first human twice, which is the one thing this factor exists to avoid.
 */

import { NextResponse } from 'next/server';

import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { getSession, unauthorized } from '@/lib/session';
import { guardianEffectiveAt } from '@/lib/guardians';
import { sendPushNotification } from '@/lib/push';
import { describeDbError } from '@/lib/db-errors';
import { logAuthEvent } from '@/lib/audit-log';

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession(request);
  if (!session) return unauthorized();

  const { id } = await params;

  let accept: boolean;
  try {
    const body = await request.json();
    accept = body?.accept !== false;
  } catch {
    accept = true;
  }

  try {
    const supabase = getSupabaseAdmin();

    // The `guardian_user_id` predicate is the authorisation check, not a filter: an id belonging
    // to someone else's invitation simply does not exist as far as this session is concerned.
    const { data: invite, error: lookupError } = await supabase
      .from('guardians')
      .select('id, user_id, status, label')
      .eq('id', id)
      .eq('guardian_user_id', session.userId)
      .maybeSingle();

    if (lookupError) throw lookupError;
    if (!invite || invite.status !== 'invited') {
      return NextResponse.json({ error: 'That invitation is no longer open' }, { status: 404 });
    }

    if (!accept) {
      // Declining is terminal. The owner can invite again, which creates a new row and a new
      // notification, rather than quietly reopening one the guardian already said no to.
      const { error } = await supabase
        .from('guardians')
        .update({ status: 'revoked', revoked_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq('id', id)
        .eq('guardian_user_id', session.userId)
        .eq('status', 'invited');

      if (error) throw error;
      return NextResponse.json({ accepted: false });
    }

    const now = new Date();

    // The cooling period is measured from this moment, not from when the invitation was sent.
    // Otherwise an attacker with a live session could create the invite, wait out the clock
    // while doing nothing suspicious, and approve it the instant it matured.
    const effectiveAt = guardianEffectiveAt(now.getTime());

    // Status stays 'pending' because that is what it is: approved by a human, not yet usable.
    // `lib/guardians.ts` derives the rest — nothing reads this string to decide access.
    const { data: updated, error } = await supabase
      .from('guardians')
      .update({
        status: 'pending',
        approved_at: now.toISOString(),
        effective_at: effectiveAt.toISOString(),
        updated_at: now.toISOString(),
      })
      .eq('id', id)
      .eq('guardian_user_id', session.userId)
      // Conditional on the state we read, so two taps cannot both land and reset the clock.
      .eq('status', 'invited')
      .select('id, effective_at')
      .maybeSingle();

    if (error) throw error;
    if (!updated) {
      return NextResponse.json({ error: 'That invitation is no longer open' }, { status: 409 });
    }

    // The owner is told, because a guardian being added is a change to who can reach their
    // account. Same reason the email change warns the old address.
    const notification = {
      userId: invite.user_id,
      type: 'security_alert' as const,
      // "in 24 hours" read as an expiry to the first person who saw it, which is the opposite of
      // what it means. The delay is a wait before the guardian becomes usable, after which they
      // stay usable until removed. Say "after", never "in".
      // The owner's own label for them, which they chose when inviting.
      message: `${invite.label} accepted being your guardian. After a 24-hour safety delay they can help you recover this account.`,
      metadata: { guardian_id: id, effective_at: updated.effective_at },
    };

    await supabase.from('notifications').insert({
      user_id: notification.userId,
      type: notification.type,
      message: notification.message,
      metadata: notification.metadata,
    });
    await sendPushNotification(notification);
    // Logged against the protected account, not the guardian: this is a change to who can reach
    // that account, and that is whose timeline it belongs on.
    await logAuthEvent(request, { type: 'guardian_approved', userId: invite.user_id });

    return NextResponse.json({ accepted: true, effectiveAt: updated.effective_at });
  } catch (error) {
    const { message } = describeDbError(error, 'Could not answer that invitation');
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
