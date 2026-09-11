/**
 * What to tell someone whose code did not work.
 *
 * One module, because the two routes that verify a code — sign-in and recovery — must not
 * disagree about what a given failure means. They did disagree before this existed only in the
 * sense that they said the same unhelpful thing, which is a kind of agreement nobody benefits
 * from: *"Verification code is incorrect or has expired"*, for every failure there is.
 *
 * That message was chosen on purpose, and the reasoning behind it was sound as far as it went.
 * Distinguishing "wrong code" from "no code in flight" tells someone probing a number whether a
 * login is in progress, which is information they should not get for free.
 *
 * What the reasoning missed is who else was paying. A code lives five minutes. Expiry is not an
 * edge case, it is the ordinary outcome of reading a message a bit late — and told only that the
 * code is "incorrect or expired", the natural response is to check the digits and type the same
 * stale code again. Three of those and the challenge is dead, at which point the message still
 * does not say why. People were being locked out of their own accounts by a message written to
 * frustrate an attacker.
 *
 * So the split here follows what the reader can act on, and stops exactly where the leak starts:
 *
 *   - A wrong code says so, and says how many tries are left. Nothing is revealed that the
 *     person guessing does not already know — they are the one making the attempts.
 *   - Expired, never requested, and consumed all give one answer: ask for a new code. From
 *     outside they are indistinguishable, so probing a number still cannot reveal whether
 *     someone is mid-login; and to an honest reader they are genuinely the same situation.
 *   - Attempts exhausted says so, because the alternative is someone typing a code they can
 *     read in front of them into a challenge that stopped listening.
 *
 * The defences that actually stop a code being guessed are untouched: six digits, three attempts
 * enforced in the database, three codes per five minutes, and an IP bucket on top.
 */

import type { OtpFailureReason } from '@/lib/otp-challenge';

export interface OtpFailureMessage {
  error: string;
  code: 'INCORRECT_OTP' | 'EXPIRED_OTP' | 'OTP_ATTEMPTS_EXHAUSTED';
  /** Present only for a wrong code, where it is the reader's own count. */
  attemptsLeft?: number;
}

const EXPIRED: OtpFailureMessage = {
  error: 'That code has expired. Ask for a new one and try again.',
  code: 'EXPIRED_OTP',
};

const EXHAUSTED: OtpFailureMessage = {
  error: 'Too many wrong tries. Ask for a new code to start again.',
  code: 'OTP_ATTEMPTS_EXHAUSTED',
};

export function otpFailureMessage(
  reason: OtpFailureReason,
  attemptsLeft = 0
): OtpFailureMessage {
  switch (reason) {
    case 'wrong_code':
      // A run of attempts is worth naming, because the alternative is someone discovering the
      // cap by hitting it. Below one remaining the count is left off — "0 tries left" alongside
      // "that code is not right" reads as a contradiction.
      return {
        error:
          attemptsLeft > 0
            ? `That code is not right. ${attemptsLeft} ${attemptsLeft === 1 ? 'try' : 'tries'} left.`
            : 'That code is not right.',
        code: 'INCORRECT_OTP',
        attemptsLeft,
      };

    case 'attempts_exhausted':
    case 'raced':
      // A race lost the attempt-count claim, which means this challenge has just been spent by a
      // request that arrived alongside this one. There is nothing left to try on it.
      return EXHAUSTED;

    case 'expired':
    case 'no_challenge':
      return EXPIRED;
  }
}

/**
 * The shape of a code that could never be checked at all — wrong length, non-digits, missing.
 *
 * Answered as "incorrect" rather than as a validation error, because it is: nothing was spent,
 * no attempt was counted, and the person needs to look at what they typed. Kept here so it reads
 * the same as a code that was checked and rejected.
 */
export const MALFORMED_OTP: OtpFailureMessage = {
  error: 'That code is not right. Enter the 6 digits we sent you.',
  code: 'INCORRECT_OTP',
};
