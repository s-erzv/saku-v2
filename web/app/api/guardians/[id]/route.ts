/**
 * Removing a guardian.
 *
 * No cooling period, deliberately, and the asymmetry is the point. Adding a guardian widens who
 * can reach the account and therefore waits; removing one narrows it. A delay on removal would
 * protect nobody except an attacker who had already been added, by keeping them in place for a
 * day after the owner noticed.
 *
 * Revocation is terminal rather than a delete, so the audit trail of who once held this power
 * survives. Re-inviting the same person creates a new row.
 */

import { NextResponse } from 'next/server';

import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { getSession, unauthorized } from '@/lib/session';
import { sendPushNotification } from '@/lib/push';
import { describeDbError } from '@/lib/db-errors';
import { logAuthEvent } from '@/lib/audit-log';

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession(request);
  if (!session) return unauthorized();

  const { id } = await params;

  try {
    const supabase = getSupabaseAdmin();
    const now = new Date().toISOString();

    const { data: removed, error } = await supabase
      .from('guardians')
      .update({ status: 'revoked', revoked_at: now, updated_at: now })
      .eq('id', id)
      // Ownership check. Only the protected account may drop its own guardian.
      .eq('user_id', session.userId)
      .neq('status', 'revoked')
      .select('id, guardian_user_id')
      .maybeSingle();

    if (error) throw error;
    if (!removed) {
      return NextResponse.json({ error: 'That guardian is already gone' }, { status: 404 });
    }

    // Told, not asked. Someone who held a power over an account should learn when it ends,
    // partly as courtesy and partly because an unexpected removal is worth noticing.
    if (removed.guardian_user_id) {
      const notification = {
        userId: removed.guardian_user_id,
        type: 'security_alert' as const,
        message: 'You are no longer a guardian for that Saku account.',
        metadata: { guardian_id: id },
      };

      await supabase.from('notifications').insert({
        user_id: notification.userId,
        type: notification.type,
        message: notification.message,
        metadata: notification.metadata,
      });
      await sendPushNotification(notification);
    }

    await logAuthEvent(request, { type: 'guardian_revoked', userId: session.userId });

    return NextResponse.json({ removed: true });
  } catch (error) {
    const { message } = describeDbError(error, 'Could not remove that guardian');
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
