/**
 * Step one of recovering an account: name the number that was lost.
 *
 * Nothing else is asked for here, deliberately. The owner always knows the number their account
 * was registered to; they do not reliably remember which address they saved as a backup months
 * ago, and they should not have to pick a new number before they know the recovery can succeed.
 * The new number comes last, in `complete`, after the email and the guardians have both answered.
 *
 * It answers plainly. If the number can be recovered, the reply names the backup address, masked,
 * so the owner knows which inbox to open; if it cannot, the reply says why now rather than after a
 * wait that could never end. That is a deliberate trade. Anyone who knows a number can learn
 * whether it has a Saku account with recovery set up, and a masked hint of its email — the same
 * kind of hint most account-recovery screens show — in exchange for a locked-out owner never
 * being left watching an inbox that will receive nothing. "No account" and "an account with no
 * backup email" get the same answer, so this does not also confirm who uses Saku at all, and the
 * per-IP limit is what keeps it from being a bulk lookup.
 *
 * What it can cost someone who is not the owner: an email to the owner's backup address saying a
 * recovery was requested. Nothing moves without that link and the guardians, and sends are
 * bounded per IP and per account. It cannot cancel the owner's own recovery either; see
 * `canReplaceOpenRecovery`.
 */

import { NextResponse } from 'next/server';

import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { InvalidPhoneNumberError, phoneHashCandidates } from '@/lib/phone';
import { findUserByPhone } from '@/lib/phone-identity';
import { createEmailToken, decryptEmail, maskEmail } from '@/lib/email';
import { EmailNotConfiguredError, sendEmail } from '@/lib/mailer';
import {
  isGuardianEligible,
  isGuardianReachable,
  nextGuardianActiveAt,
  type GuardianRow,
} from '@/lib/guardians';
import {
  canReplaceOpenRecovery,
  recoveryExpiresAt,
  recoveryStage,
  type RecoveryRequestRow,
} from '@/lib/recovery';
import { checkRateLimit, RATE_LIMITS } from '@/lib/rate-limiter';
import { clientKey } from '@/lib/request-meta';
import { appOrigin } from '@/lib/app-url';

const NOT_RECOVERABLE = {
  error:
    'This number cannot be recovered. Recovery only works if the account had a backup email and an active guardian before the number was lost.',
  code: 'NOT_RECOVERABLE',
};

export async function POST(request: Request) {
  // Tighter than the general per-IP limit: each request can put an email in someone's inbox, and
  // each answer says whether a number is recoverable.
  if (!(await checkRateLimit(clientKey(request, 'recovery-start'), RATE_LIMITS.OTP_REQUEST)).allowed) {
    return NextResponse.json({ error: 'Too many attempts. Try again in a few minutes.' }, { status: 429 });
  }

  let oldPhone: string;
  let oldCountry: string;
  try {
    const body = await request.json();
    oldPhone = body.oldPhone;
    oldCountry = body.oldCountryCode || '62';
    phoneHashCandidates(oldPhone, oldCountry);
  } catch (error) {
    if (error instanceof InvalidPhoneNumberError) {
      return NextResponse.json({ error: 'Invalid phone number' }, { status: 400 });
    }
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }

  try {
    const supabase = getSupabaseAdmin();

    const { user: owner } = await findUserByPhone<{
      id: string;
      email_ciphertext: string | null;
      email_verified_at: string | null;
    }>(supabase, oldPhone, oldCountry, 'id, email_ciphertext, email_verified_at');

    if (!owner?.email_ciphertext || !owner.email_verified_at) {
      return NextResponse.json(NOT_RECOVERABLE, { status: 422 });
    }

    const address = decryptEmail(owner.email_ciphertext);
    const maskedEmail = maskEmail(address);
    const now = new Date();

    const { data: open, error: openError } = await supabase
      .from('recovery_requests')
      .select('id, status, email_verified_at, guardian_approved_at, expires_at, required_approvals')
      .eq('user_id', owner.id)
      .eq('status', 'pending')
      .maybeSingle();

    if (openError) throw openError;

    // Checked before the guardians, because a recovery already under way is the answer that
    // matters: its guardians have already been counted, and saying "no active guardian" to
    // someone one step from finishing would send them the wrong way.
    if (open && !canReplaceOpenRecovery(open as RecoveryRequestRow, now.getTime())) {
      // The owner already confirmed this one and still holds its links. Nothing new is sent, so
      // the reply says where it stands and which email to reopen — "check your inbox" alone read
      // as a message that never arrived.
      const stage = recoveryStage(open as RecoveryRequestRow, now.getTime());

      let progress: { approved: number; panel: number; required: number | null } | null = null;
      if (stage === 'awaiting_guardian') {
        const { data: seats } = await supabase
          .from('recovery_request_guardians')
          .select('approved_at')
          .eq('recovery_request_id', open.id);
        progress = {
          approved: (seats ?? []).filter((s) => s.approved_at).length,
          panel: seats?.length ?? 0,
          required: open.required_approvals ?? null,
        };
      }

      return NextResponse.json({
        started: true,
        alreadyOpen: true,
        maskedEmail,
        stage,
        expiresAt: open.expires_at,
        progress,
      });
    }

    // An email on its own cannot finish a recovery (see `lib/recovery.ts`), so an account with no
    // usable guardian is told now. Starting anyway would send a link that leads to "there is no
    // guardian to ask", which is a wait for nothing.
    const { data: guardianRows, error: guardianError } = await supabase
      .from('guardians')
      .select('id, guardian_user_id, invite_phone_ciphertext, status, approved_at, effective_at')
      .eq('user_id', owner.id)
      .neq('status', 'revoked');

    if (guardianError) throw guardianError;

    const reachable = (guardianRows ?? []).filter(isGuardianReachable) as GuardianRow[];

    if (!reachable.some((g) => isGuardianEligible(g))) {
      // Said specifically rather than folded into NOT_RECOVERABLE. The generic sentence read as
      // "you have no backup email" to an owner whose email was confirmed and whose guardian was
      // only still inside the 24-hour wait. It does reveal that this number has an account with a
      // backup email — no more than the masked address in the success reply already does.
      const activeFrom = nextGuardianActiveAt(reachable);
      return NextResponse.json(
        {
          error: activeFrom
            ? 'This account has a backup email, but its guardian is still inside the 24-hour safety wait.'
            : 'This account has a backup email but no guardian, and a backup email alone cannot recover an account.',
          code: 'NO_ACTIVE_GUARDIAN',
          activeFrom: activeFrom?.toISOString() ?? null,
        },
        { status: 422 }
      );
    }

    // A phone number is far easier to learn than an email address, so this is the knob that stops
    // anyone who knows it from filling the owner's inbox.
    if (!(await checkRateLimit(`recovery-account:${owner.id}`, RATE_LIMITS.OTP_REQUEST)).allowed) {
      return NextResponse.json(
        {
          error: `A recovery link was just sent to ${maskedEmail}. Check that inbox, or wait a few minutes before asking for another.`,
          code: 'RATE_LIMITED',
        },
        { status: 429 }
      );
    }

    if (open) {
      // One open attempt per account, so an attacker cannot queue requests and wait for a
      // guardian to tap approve on one of them out of fatigue.
      await supabase
        .from('recovery_requests')
        .update({ status: 'expired', resolved_at: now.toISOString(), updated_at: now.toISOString() })
        .eq('id', open.id)
        .eq('status', 'pending');
    }

    const verify = createEmailToken();

    const { error: insertError } = await supabase.from('recovery_requests').insert({
      user_id: owner.id,
      method: 'email',
      status: 'pending',
      email_token_hash: verify.hash,
      expires_at: recoveryExpiresAt(now.getTime()).toISOString(),
    });

    if (insertError) {
      // A concurrent start for the same account won the one-open-request index. Its email is
      // going to the same inbox right now, so "we sent a link" is still the truth.
      if (insertError.code === '23505') {
        return NextResponse.json({ started: true, alreadyOpen: false, maskedEmail }, { status: 202 });
      }
      throw insertError;
    }

    const link = `${appOrigin(request)}/api/recovery/verify-email?token=${verify.token}`;

    await sendEmail({
      // Read back from the account, so a recovery mail can only ever go to the address on file.
      to: address,
      subject: 'Someone is trying to recover your Saku account',
      text:
        'A request was made to recover your Saku account onto a new phone number.\n\n' +
        `If this was you, confirm it here:\n${link}\n\n` +
        'Next, most of your guardians have to confirm it is really you. Once they do, we will email ' +
        'you a second link to choose your new number. You can open the link above again at any ' +
        'time to see where things stand.\n\n' +
        'If this was not you, do nothing. Nothing changes without your guardians, and the request ' +
        'expires on its own in seven days.',
    });

    return NextResponse.json({ started: true, alreadyOpen: false, maskedEmail }, { status: 202 });
  } catch (error) {
    if (error instanceof EmailNotConfiguredError) {
      return NextResponse.json(
        { error: 'Email is not set up on this deployment yet', code: 'NOT_CONFIGURED' },
        { status: 503 }
      );
    }
    console.error('[recovery:start]', error);
    return NextResponse.json({ error: 'Could not start that recovery' }, { status: 500 });
  }
}
