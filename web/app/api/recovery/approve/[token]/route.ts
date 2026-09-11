/**
 * A guardian's answer to a recovery, from the link sent to their WhatsApp.
 *
 * The counterpart to `/api/recovery/[id]/approve`, which serves a guardian who has a Saku
 * account and a session to be authorised by. This one serves a guardian who has neither, so the
 * token is the credential.
 *
 * What keeps that acceptable is how narrow the token is. It lives on one seat of one panel, so
 * it votes on the recovery it was issued for and no other. It is spent by the vote it casts. It
 * dies with the request. And the vote it carries is never sufficient on its own: the recovery
 * also needs the owner's own backup email to have answered, and a majority of the panel, which
 * was fixed before any of these links existed.
 *
 * The decision itself — counting the majority, minting the owner's finish link, undoing it if
 * that link cannot be sent — is not repeated here. It lives in `lib/recovery-vote.ts` so that
 * both doors open onto the same room.
 */

import { NextResponse } from 'next/server';

import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { isGuardianEligible, type GuardianRow } from '@/lib/guardians';
import { isRecoveryExpired, type RecoveryRequestRow } from '@/lib/recovery';
import { castGuardianVote } from '@/lib/recovery-vote';
import { hashGuardianToken } from '@/lib/guardian-invite';
import { EmailNotConfiguredError } from '@/lib/mailer';
import { checkRateLimit, RATE_LIMITS } from '@/lib/rate-limiter';
import { clientKey } from '@/lib/request-meta';
import { describeDbError } from '@/lib/db-errors';
import { appOrigin } from '@/lib/app-url';
import { logAuthEvent } from '@/lib/audit-log';

/**
 * One answer for a token that is unknown, spent, expired, or attached to a request that has
 * since closed. Telling them apart would make this an oracle, and the page ends at the same
 * sentence either way.
 */
const DEAD_LINK = {
  error: 'This link is no longer open. The request may have been answered already, or it expired.',
  code: 'DEAD_LINK',
};

interface Seat {
  guardianId: string;
  recovery: RecoveryRequestRow & {
    id: string;
    user_id: string;
    required_approvals: number;
    expires_at: string;
    requested_at: string;
    email_verified_at: string | null;
    guardian_approved_at: string | null;
  };
  ownerName: string;
}

/**
 * Resolve a link to the seat it votes from, or nothing.
 *
 * Every condition the in-app route checks is checked here too, against the same columns: the
 * request is open, the email has answered and fixed the panel, the majority is not already in,
 * and this guardian is still eligible. Authorisation by link rather than by session changes who
 * is asking, never what they are allowed to do.
 */
async function resolveSeat(token: string): Promise<Seat | null> {
  const supabase = getSupabaseAdmin();

  const { data: seat, error } = await supabase
    .from('recovery_request_guardians')
    .select('recovery_request_id, guardian_id, approved_at, token_expires_at')
    .eq('approve_token_hash', hashGuardianToken(token))
    .maybeSingle();

  if (error) throw error;
  if (!seat) return null;
  // Spent. A vote already cast cannot be cast again, and re-casting is how a leaked link would
  // otherwise be worth more than the one answer it was issued for.
  if (seat.approved_at) return null;
  if (seat.token_expires_at && new Date(seat.token_expires_at).getTime() <= Date.now()) return null;

  const { data: recovery, error: recoveryError } = await supabase
    .from('recovery_requests')
    .select(
      'id, user_id, status, new_phone_hash, email_verified_at, guardian_approved_at, required_approvals, expires_at, requested_at'
    )
    .eq('id', seat.recovery_request_id)
    .eq('status', 'pending')
    .maybeSingle();

  if (recoveryError) throw recoveryError;
  if (!recovery) return null;
  if (isRecoveryExpired(recovery as RecoveryRequestRow)) return null;

  // Nothing to vouch for before the owner's email has fixed the panel, and nothing left to
  // decide once the majority is in.
  if (!recovery.email_verified_at || !recovery.required_approvals || recovery.guardian_approved_at) {
    return null;
  }

  const { data: guardian, error: guardianError } = await supabase
    .from('guardians')
    .select('id, status, approved_at, effective_at')
    .eq('id', seat.guardian_id)
    .neq('status', 'revoked')
    .maybeSingle();

  if (guardianError) throw guardianError;
  // Revoked since the panel was fixed, or never past their own cooling period.
  if (!guardian || !isGuardianEligible(guardian as GuardianRow)) return null;

  const { data: owner } = await supabase
    .from('users')
    .select('display_name')
    .eq('id', recovery.user_id)
    .maybeSingle();

  return {
    guardianId: seat.guardian_id,
    recovery: recovery as Seat['recovery'],
    ownerName: owner?.display_name?.trim() || 'A Saku user',
  };
}

export async function GET(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  if (!(await checkRateLimit(clientKey(request, 'guardian-vote'), RATE_LIMITS.IP_BASED)).allowed) {
    return NextResponse.json({ error: 'Too many attempts' }, { status: 429 });
  }

  try {
    const seat = await resolveSeat(token);
    if (!seat) return NextResponse.json(DEAD_LINK, { status: 410 });

    const supabase = getSupabaseAdmin();
    const { count } = await supabase
      .from('recovery_request_guardians')
      .select('guardian_id', { count: 'exact', head: true })
      .eq('recovery_request_id', seat.recovery.id)
      .not('approved_at', 'is', null);

    return NextResponse.json({
      owner: seat.ownerName,
      requestedAt: seat.recovery.requested_at,
      approvals: count ?? 0,
      required: seat.recovery.required_approvals,
    });
  } catch (error) {
    const { message } = describeDbError(error, 'Could not open that link');
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  if (!(await checkRateLimit(clientKey(request, 'guardian-vote'), RATE_LIMITS.IP_BASED)).allowed) {
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
    const seat = await resolveSeat(token);
    if (!seat) return NextResponse.json(DEAD_LINK, { status: 410 });

    const outcome = await castGuardianVote(supabase, {
      recoveryId: seat.recovery.id,
      guardianId: seat.guardianId,
      ownerId: seat.recovery.user_id,
      previousExpiresAt: seat.recovery.expires_at,
      requiredApprovals: seat.recovery.required_approvals,
      accept,
      appOrigin: appOrigin(request),
    });

    // Burned whichever way it was answered, so the link in that WhatsApp message is inert from
    // here on. A rejection spends it as surely as an approval does.
    await supabase
      .from('recovery_request_guardians')
      .update({ approve_token_hash: null })
      .eq('recovery_request_id', seat.recovery.id)
      .eq('guardian_id', seat.guardianId);

    await logAuthEvent(request, {
      type: 'recovery_guardian_voted',
      userId: seat.recovery.user_id,
      metadata: { via: 'whatsapp', accepted: accept, outcome: outcome.kind },
    });

    if (outcome.kind === 'rejected') return NextResponse.json({ accepted: false });

    if (outcome.kind === 'no_backup_email') {
      return NextResponse.json(
        { error: 'That account no longer has a backup email, so this recovery cannot finish.' },
        { status: 409 }
      );
    }

    return NextResponse.json({
      accepted: true,
      completed: outcome.kind === 'completed',
      approvals: outcome.approvals,
      required: outcome.required,
    });
  } catch (error) {
    if (error instanceof EmailNotConfiguredError) {
      return NextResponse.json(
        { error: 'Email is not set up on this deployment yet', code: 'NOT_CONFIGURED' },
        { status: 503 }
      );
    }
    const { message } = describeDbError(error, 'Could not record that answer');
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
