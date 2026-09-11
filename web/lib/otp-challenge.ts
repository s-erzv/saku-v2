/**
 * Spending an OTP challenge, once.
 *
 * Extracted so recovery can hold a phone number to the same standard sign-in does. The
 * alternative was a second copy of the attempt counter, the single-use burn and the race
 * handling in the recovery route, and a second copy of a rule like this drifts: one side gets a
 * fix, the other keeps the hole, and the weaker of the two is the one an attacker uses.
 *
 * The failure reason is now told apart, and returned. It used to collapse into one `false` on
 * the argument that distinguishing "wrong code" from "expired" tells an attacker when a fresh
 * code is in flight. That argument is real but it was being paid for by the wrong people: a code
 * lives five minutes, so expiry is the ordinary case, and "incorrect or expired" makes someone
 * retype the same correct-but-stale code until all three attempts are gone and they are locked
 * out of their own account.
 *
 * What is kept is the part that actually leaks. "Expired" and "never requested" return the same
 * answer, so probing a number still cannot reveal whether a login is in progress — the cases are
 * indistinguishable from outside, and identical from the reader's point of view anyway, since
 * both end at "ask for a new code". See `lib/otp-message.ts`.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

import { isOtpExpired, OTP_MAX_ATTEMPTS, otpMatches } from '@/lib/otp';

export type OtpFailureReason =
  | 'no_challenge'
  | 'expired'
  | 'attempts_exhausted'
  | 'raced'
  | 'wrong_code';

export interface OtpConsumeResult {
  ok: boolean;
  /** Mapped to a message by `lib/otp-message.ts`; logged verbatim. */
  reason: 'matched' | OtpFailureReason;
  attempt: number;
  /** Tries remaining on this challenge. Zero whenever the challenge itself is finished. */
  attemptsLeft: number;
}

export async function consumeOtpChallenge(
  supabase: SupabaseClient,
  phoneHash: string,
  otp: string
): Promise<OtpConsumeResult> {
  // Deliberately not filtered on `expires_at`. The filter is what made an expired code and a
  // number nobody ever requested a code for look identical, and telling those apart is the whole
  // point of this change. Ordering by `created_at` still picks the code the caller is holding:
  // codes are issued in order, so the newest unconsumed row is always the most recent one sent.
  const { data: challenge, error } = await supabase
    .from('otp_challenges')
    .select('id, code_hmac, attempt_count, expires_at')
    .eq('phone_hash', phoneHash)
    .is('consumed_at', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  if (!challenge) return { ok: false, reason: 'no_challenge', attempt: 0, attemptsLeft: 0 };

  // Checked before the attempt is counted. Burning one of three tries on a code that could not
  // have worked punishes someone for the clock running out while they read the message.
  if (isOtpExpired(challenge.expires_at)) {
    return { ok: false, reason: 'expired', attempt: challenge.attempt_count, attemptsLeft: 0 };
  }

  if (challenge.attempt_count >= OTP_MAX_ATTEMPTS) {
    await supabase
      .from('otp_challenges')
      .update({ consumed_at: new Date().toISOString() })
      .eq('id', challenge.id);
    return { ok: false, reason: 'attempts_exhausted', attempt: challenge.attempt_count, attemptsLeft: 0 };
  }

  // Count the attempt before checking the code, conditional on the value just read. Two requests
  // racing means only one increment lands and the loser is rejected, so the cap cannot be
  // sidestepped by firing guesses in parallel.
  const { data: claimed, error: claimError } = await supabase
    .from('otp_challenges')
    .update({ attempt_count: challenge.attempt_count + 1 })
    .eq('id', challenge.id)
    .eq('attempt_count', challenge.attempt_count)
    .is('consumed_at', null)
    .select('id')
    .maybeSingle();

  if (claimError) throw claimError;
  if (!claimed) return { ok: false, reason: 'raced', attempt: challenge.attempt_count, attemptsLeft: 0 };

  if (!otpMatches(otp, phoneHash, challenge.code_hmac)) {
    return {
      ok: false,
      reason: 'wrong_code',
      attempt: challenge.attempt_count + 1,
      attemptsLeft: Math.max(0, OTP_MAX_ATTEMPTS - (challenge.attempt_count + 1)),
    };
  }

  // Burned before the caller does anything with the result, so a replay of the same request
  // cannot ride the same challenge.
  await supabase
    .from('otp_challenges')
    .update({ consumed_at: new Date().toISOString() })
    .eq('id', challenge.id);

  return { ok: true, reason: 'matched', attempt: challenge.attempt_count + 1, attemptsLeft: 0 };
}
