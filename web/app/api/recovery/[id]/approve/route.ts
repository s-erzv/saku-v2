/**
 * A guardian answering a recovery request.
 *
 * A recovery needs a majority of the guardians on its panel, not just one — see
 * `requiredGuardianApprovals`. Who sits on the panel, and how many must agree, was fixed when the
 * owner's email answered, so guardians removed since cannot lower the bar and guardians added
 * since get no vote.
 *
 * One "no" ends the request. A guardian saying "this is not them" is too strong a signal to be
 * outvoted by the others.
 *
 * Reaching the majority does not move the account. It unlocks the last step for the owner: a
 * second email, to the same backup address, with a link to choose the new number. The account
 * changes hands only in `app/api/recovery/complete`, the one place allowed to do it. The link goes
 * to the backup address rather than onto this screen, because a guardian is not the owner and the
 * device they approved from is theirs.
 *
 * Approving is idempotent. A guardian who taps twice, or taps again after the second email failed
 * to send, re-runs the majority check rather than being told they already voted — otherwise a
 * failed send after the deciding vote would strand the request with nobody left to retry it.
 */

import { NextResponse } from 'next/server';

import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { getSession, unauthorized } from '@/lib/session';
import { isGuardianEligible, type GuardianRow } from '@/lib/guardians';
import { isRecoveryExpired, type RecoveryRequestRow } from '@/lib/recovery';
import { EmailNotConfiguredError } from '@/lib/mailer';
import { castGuardianVote } from '@/lib/recovery-vote';
import { describeDbError } from '@/lib/db-errors';
import { appOrigin } from '@/lib/app-url';

const NOT_OPEN = { error: 'That request is no longer open' };

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

    const { data: recovery, error } = await supabase
      .from('recovery_requests')
      .select('id, user_id, status, email_verified_at, guardian_approved_at, expires_at, required_approvals')
      .eq('id', id)
      .eq('status', 'pending')
      .maybeSingle();

    if (error) throw error;
    if (!recovery) return NextResponse.json(NOT_OPEN, { status: 404 });

    if (isRecoveryExpired(recovery as RecoveryRequestRow)) {
      await supabase
        .from('recovery_requests')
        .update({ status: 'expired', resolved_at: new Date().toISOString() })
        .eq('id', id);
      return NextResponse.json({ error: 'That request has expired' }, { status: 410 });
    }

    // Nothing to vouch for until the owner's email has answered and fixed the panel, and nothing
    // left to decide once the majority is in. The guardians list hides both; this is what holds
    // when someone calls the endpoint directly.
    if (!recovery.email_verified_at || !recovery.required_approvals || recovery.guardian_approved_at) {
      return NextResponse.json(NOT_OPEN, { status: 404 });
    }

    // Authorisation: the caller has to be a guardian of the account being recovered, approved
    // and past their own cooling period. Anything less and a guardian added an hour ago by
    // whoever is doing the recovering could wave it through.
    const { data: guardianRow } = await supabase
      .from('guardians')
      .select('id, status, approved_at, effective_at')
      .eq('user_id', recovery.user_id)
      .eq('guardian_user_id', session.userId)
      .neq('status', 'revoked')
      .maybeSingle();

    if (!guardianRow || !isGuardianEligible(guardianRow as GuardianRow)) {
      return NextResponse.json(NOT_OPEN, { status: 404 });
    }

    // And a seat on this request's panel. A guardian added after the email answered has none.
    const { data: seat, error: seatError } = await supabase
      .from('recovery_request_guardians')
      .select('approved_at')
      .eq('recovery_request_id', id)
      .eq('guardian_id', guardianRow.id)
      .maybeSingle();

    if (seatError) throw seatError;
    if (!seat) return NextResponse.json(NOT_OPEN, { status: 404 });

    const outcome = await castGuardianVote(supabase, {
      recoveryId: id,
      guardianId: guardianRow.id,
      ownerId: recovery.user_id,
      previousExpiresAt: recovery.expires_at,
      requiredApprovals: recovery.required_approvals,
      accept,
      appOrigin: appOrigin(request),
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
    const { message } = describeDbError(error, 'Could not answer that request');
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
