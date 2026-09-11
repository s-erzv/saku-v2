/**
 * The last step of a recovery, and the only place an account changes phone numbers.
 *
 * By the time anyone gets here the backup email has answered and a guardian has approved; the
 * ticket cookie from the second email is the proof of both. What is left is for the new number to
 * prove itself with an OTP, and then the move: everything filed under the old number moves to the
 * new one together, every session the old number ever opened is revoked, and the person who
 * finished is signed straight in.
 *
 * Signing them in here is not a shortcut around sign-in. They have just answered a stronger check
 * than sign-in asks for — an OTP on this same number, plus the email and a guardian — and making
 * them type a second code into the next screen would add a step without adding any proof.
 */

import { NextResponse, type NextRequest } from 'next/server';

import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { assertSameOrigin, setSessionCookie } from '@/lib/session';
import { generateToken } from '@/lib/jwt';
import { hashPhone, InvalidPhoneNumberError, phoneHashCandidates } from '@/lib/phone';
import { findUserByPhone } from '@/lib/phone-identity';
import { consumeOtpChallenge, type OtpFailureReason } from '@/lib/otp-challenge';
import { MALFORMED_OTP, otpFailureMessage } from '@/lib/otp-message';
import { isWellFormedOtp } from '@/lib/otp';
import { hashToken, tokenMatches } from '@/lib/email';
import { canCompleteRecovery, type RecoveryRequestRow } from '@/lib/recovery';
import { clearRecoveryTicket, readRecoveryTicket } from '@/lib/recovery-ticket';
import { checkRateLimit, RATE_LIMITS } from '@/lib/rate-limiter';
import { clientKey } from '@/lib/request-meta';
import { sendPushNotification } from '@/lib/push';
import { logAuthEvent } from '@/lib/audit-log';



const CLOSED = {
  error: 'This recovery is no longer open. Open the latest link from your email, or start again.',
  code: 'RECOVERY_CLOSED',
};

const NUMBER_IN_USE = {
  error: 'That number already has a Saku account. Choose a different number.',
  code: 'NUMBER_IN_USE',
};

export async function POST(request: NextRequest) {
  // The ticket is a cookie, so this is exactly the kind of request a hostile page could make a
  // browser send.
  if (!assertSameOrigin(request)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  if (!(await checkRateLimit(clientKey(request, 'recovery-complete'), RATE_LIMITS.OTP_VERIFY)).allowed) {
    return NextResponse.json({ error: 'Too many attempts' }, { status: 429 });
  }

  const ticket = readRecoveryTicket(request);
  if (!ticket) return NextResponse.json(CLOSED, { status: 410 });

  let phone: string;
  let country: string;
  let otp: string;
  try {
    const body = await request.json();
    if (!isWellFormedOtp(body.otp)) return NextResponse.json(MALFORMED_OTP, { status: 400 });
    otp = body.otp;
    phone = body.phone;
    country = body.countryCode || '62';
    phoneHashCandidates(phone, country);
  } catch (error) {
    if (error instanceof InvalidPhoneNumberError) {
      return NextResponse.json({ error: 'Invalid phone number' }, { status: 400 });
    }
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }

  const newPhoneHash = hashPhone(phone, country);

  try {
    const supabase = getSupabaseAdmin();

    const { data: recovery, error } = await supabase
      .from('recovery_requests')
      .select('id, user_id, status, email_verified_at, guardian_approved_at, expires_at, finish_token_hash')
      .eq('finish_token_hash', hashToken(ticket))
      .maybeSingle();

    if (error) throw error;

    if (
      !recovery?.finish_token_hash ||
      !tokenMatches(ticket, recovery.finish_token_hash) ||
      !canCompleteRecovery(recovery as RecoveryRequestRow)
    ) {
      return clearRecoveryTicket(NextResponse.json(CLOSED, { status: 410 }));
    }

    // The ticket is checked first, so nobody without one can burn codes on a number.
    const consumed = await consumeOtpChallenge(supabase, newPhoneHash, otp);
    if (!consumed.ok) {
      await logAuthEvent(request, {
        type: 'otp_verify_failed',
        phoneHash: newPhoneHash,
        metadata: { flow: 'recovery', reason: consumed.reason },
      });
      // The same wording sign-in uses. Someone at the last step of recovering an account is the
      // last person who should be guessing at why their code was refused.
      return NextResponse.json(
        otpFailureMessage(consumed.reason as OtpFailureReason, consumed.attemptsLeft),
        { status: 400 }
      );
    }

    // Both hashing rules, or an account still on the legacy hash would be missed and the move
    // would leave two accounts answering to the same number.
    const { user: taken } = await findUserByPhone(supabase, phone, country);
    if (taken) return NextResponse.json(NUMBER_IN_USE, { status: 409 });

    const { data: owner, error: ownerError } = await supabase
      .from('users')
      .select('phone_hash, token_version')
      .eq('id', recovery.user_id)
      .maybeSingle();

    if (ownerError) throw ownerError;
    if (!owner) return clearRecoveryTicket(NextResponse.json(CLOSED, { status: 410 }));

    const now = new Date().toISOString();

    // Claimed before anything moves, conditional on the ticket still being live, so two submits
    // racing cannot both run the move below. Clearing the hash is what makes the link single-use.
    const { data: claimed, error: claimError } = await supabase
      .from('recovery_requests')
      .update({
        status: 'approved',
        new_phone_hash: newPhoneHash,
        finish_token_hash: null,
        resolved_at: now,
        updated_at: now,
      })
      .eq('id', recovery.id)
      .eq('status', 'pending')
      .eq('finish_token_hash', recovery.finish_token_hash)
      .select('id')
      .maybeSingle();

    if (claimError) throw claimError;
    if (!claimed) return clearRecoveryTicket(NextResponse.json(CLOSED, { status: 410 }));

    // Hands the request back if the move fails, so the owner can retry with the same link.
    const release = () =>
      supabase
        .from('recovery_requests')
        .update({
          status: 'pending',
          new_phone_hash: null,
          finish_token_hash: recovery.finish_token_hash,
          resolved_at: null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', recovery.id);

    const nextVersion = (owner.token_version ?? 0) + 1;

    // Sessions die before the number moves. If the move then fails, the worst case is whoever
    // holds the old number signed out of an unmoved account — a nuisance. The other order could
    // leave the account on the new number with the old holder still signed in, which is the one
    // situation a recovery exists to end.
    const { error: revokeError } = await supabase
      .from('users')
      .update({ token_version: nextVersion, updated_at: now })
      .eq('id', recovery.user_id);

    if (revokeError) {
      await release();
      throw revokeError;
    }

    // Through `migrate_phone_hash` rather than a bare update of `users`: contacts, split bills,
    // off-ramp requests and history all file things under the account's number, and moving the
    // `users` row alone would hide the owner's own split bills from them and leave everyone who
    // saved them as a contact pointed at a number they no longer hold. That function moves every
    // table in one transaction.
    const { error: moveError } = await supabase.rpc('migrate_phone_hash', {
      p_user_id: recovery.user_id,
      p_old_hash: owner.phone_hash,
      p_new_hash: newPhoneHash,
    });

    if (moveError) {
      await release();
      // Someone registered this number between the check above and the move.
      if (moveError.code === '23505') return NextResponse.json(NUMBER_IN_USE, { status: 409 });
      throw moveError;
    }

    const notification = {
      userId: recovery.user_id,
      type: 'security_alert' as const,
      message: 'Your account was recovered to a new phone number. Every other device was signed out.',
      metadata: { recovery_request_id: recovery.id },
    };
    await supabase.from('notifications').insert({
      user_id: notification.userId,
      type: notification.type,
      message: notification.message,
      metadata: notification.metadata,
    });
    await sendPushNotification(notification);

    await logAuthEvent(request, {
      type: 'session_revoked',
      userId: recovery.user_id,
      phoneHash: newPhoneHash,
      metadata: { reason: 'account_recovered' },
    });

    const token = await generateToken({
      phoneHash: newPhoneHash,
      userId: recovery.user_id,
      version: nextVersion,
    });

    return clearRecoveryTicket(setSessionCookie(NextResponse.json({ completed: true }), token));
  } catch (error) {
    console.error('[recovery:complete]', error);
    return NextResponse.json({ error: 'Could not finish that recovery' }, { status: 500 });
  }
}
