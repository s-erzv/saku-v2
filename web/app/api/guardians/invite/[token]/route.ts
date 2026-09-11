/**
 * Accepting or declining a guardian invitation, without an account.
 *
 * The link is the credential. There is no session here and there cannot be: the whole point of
 * this path is a guardian who does not use Saku. What makes that acceptable is how little the
 * token can do — it binds to exactly one invitation row, it says yes or no to being a guardian,
 * and being a guardian is not itself access to anything. Recovery still needs the owner's backup
 * email and a majority of the panel, and this guardian still waits out the 24-hour cooling
 * period before counting at all.
 *
 * GET describes the invitation so the page can render it. POST answers it.
 */

import { NextResponse } from 'next/server';

import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { guardianEffectiveAt, GUARDIAN_COOLING_PERIOD_MS } from '@/lib/guardians';
import { hashGuardianToken, isGuardianInviteExpired } from '@/lib/guardian-invite';
import { checkRateLimit, RATE_LIMITS } from '@/lib/rate-limiter';
import { clientKey } from '@/lib/request-meta';
import { sendPushNotification } from '@/lib/push';
import { describeDbError } from '@/lib/db-errors';

/**
 * One answer for a token that is unknown, spent, revoked or aged out.
 *
 * Telling them apart would turn this into an oracle for whether a given token ever existed,
 * and the page has nothing useful to do with the difference anyway — every one of them ends at
 * "ask them to invite you again".
 */
const DEAD_LINK = {
  error: 'This invitation is no longer open. Ask them to send you a new one.',
  code: 'DEAD_LINK',
};

interface InviteRow {
  id: string;
  user_id: string;
  label: string;
  status: string;
  invited_at: string;
}

async function findInvite(token: string): Promise<InviteRow | null> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from('guardians')
    .select('id, user_id, label, status, invited_at')
    .eq('invite_token_hash', hashGuardianToken(token))
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;
  if (data.status !== 'invited') return null;
  if (isGuardianInviteExpired(data.invited_at)) return null;
  return data as InviteRow;
}

/** The inviter as this reader would know them: their own display name, or nothing useful. */
async function inviterName(userId: string): Promise<string> {
  const supabase = getSupabaseAdmin();
  const { data } = await supabase
    .from('users')
    .select('display_name')
    .eq('id', userId)
    .maybeSingle();
  return data?.display_name?.trim() || 'A Saku user';
}

export async function GET(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  // Unauthenticated and addressable by anyone who guesses a URL, so it gets the same IP bucket
  // the other public lookups use. A 32-byte token is not guessable, but a bucket is what keeps
  // that from being the only thing standing between this table and a scraper.
  if (!(await checkRateLimit(clientKey(request, 'guardian-invite'), RATE_LIMITS.IP_BASED)).allowed) {
    return NextResponse.json({ error: 'Too many attempts' }, { status: 429 });
  }

  try {
    const invite = await findInvite(token);
    if (!invite) return NextResponse.json(DEAD_LINK, { status: 410 });

    return NextResponse.json({
      inviter: await inviterName(invite.user_id),
      // What the owner called them. Shown back so the reader can tell a mistaken invitation from
      // one meant for them.
      label: invite.label,
      coolingHours: Math.round(GUARDIAN_COOLING_PERIOD_MS / (60 * 60 * 1000)),
    });
  } catch (error) {
    const { message } = describeDbError(error, 'Could not open that invitation');
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  if (!(await checkRateLimit(clientKey(request, 'guardian-invite'), RATE_LIMITS.IP_BASED)).allowed) {
    return NextResponse.json({ error: 'Too many attempts' }, { status: 429 });
  }

  let accept: boolean;
  try {
    const body = await request.json();
    accept = body.accept === true;
  } catch {
    return NextResponse.json({ error: 'An answer is required' }, { status: 400 });
  }

  try {
    const supabase = getSupabaseAdmin();
    const invite = await findInvite(token);
    if (!invite) return NextResponse.json(DEAD_LINK, { status: 410 });

    const now = new Date();

    if (!accept) {
      // Revoked rather than deleted, so the owner sees that the invitation was answered rather
      // than watching it sit at "invited" forever and wondering whether it arrived.
      const { error } = await supabase
        .from('guardians')
        .update({
          status: 'revoked',
          revoked_at: now.toISOString(),
          invite_token_hash: null,
          updated_at: now.toISOString(),
        })
        .eq('id', invite.id)
        .eq('status', 'invited');

      if (error) throw error;

      await notifyOwner(
        invite.user_id,
        `${invite.label} declined your guardian invitation.`,
        invite.id
      );
      return NextResponse.json({ accepted: false });
    }

    // The token is cleared in the same write that spends it, and the write is conditional on the
    // row still being `invited`. Two taps on the same link race, and only one lands.
    const { data: accepted, error } = await supabase
      .from('guardians')
      .update({
        status: 'pending',
        approved_at: now.toISOString(),
        // Measured from acceptance, not from invitation, so an attacker cannot pre-warm an
        // invite and have the clock already spent by the time they answer it.
        effective_at: guardianEffectiveAt(now.getTime()).toISOString(),
        invite_token_hash: null,
        updated_at: now.toISOString(),
      })
      .eq('id', invite.id)
      .eq('status', 'invited')
      .select('id')
      .maybeSingle();

    if (error) throw error;
    if (!accepted) return NextResponse.json(DEAD_LINK, { status: 410 });

    await notifyOwner(
      invite.user_id,
      `${invite.label} accepted, and can help you recover this account in 24 hours.`,
      invite.id
    );

    return NextResponse.json({ accepted: true });
  } catch (error) {
    const { message } = describeDbError(error, 'Could not answer that invitation');
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

async function notifyOwner(ownerId: string, message: string, guardianId: string): Promise<void> {
  const supabase = getSupabaseAdmin();
  const notification = {
    userId: ownerId,
    type: 'security_alert' as const,
    message,
    metadata: { guardian_id: guardianId },
  };

  await supabase.from('notifications').insert({
    user_id: notification.userId,
    type: notification.type,
    message: notification.message,
    metadata: notification.metadata,
  });
  await sendPushNotification(notification);
}
