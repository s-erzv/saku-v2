/**
 * OTP code generation and verification primitives.
 *
 * What changed from v1, and why each one mattered:
 *
 *  - Codes were generated with `Math.random()`, which is a non-cryptographic PRNG. Its output
 *    is predictable from previous outputs, so an attacker who could request a few codes for
 *    their own number could narrow down someone else's. Now `crypto.randomInt`.
 *  - Codes were stored *encrypted*, meaning anyone holding `ENCRYPTION_KEY` could read live
 *    codes straight out of the database. An OTP never needs to be readable again — only
 *    comparable — so it is stored as an HMAC.
 *  - Comparison was `===` on the decrypted string, which leaks position-of-first-difference
 *    through timing. Now `timingSafeEqual`.
 *  - There was no working server-side attempt cap, so a short code could be swept. {@link
 *    OTP_MAX_ATTEMPTS} is now enforced in the database, and the code itself is longer — see
 *    {@link OTP_LENGTH}.
 */

import { createHmac, randomInt, timingSafeEqual } from 'crypto';

import { OTP_LENGTH } from '@/lib/otp-shape';

export { OTP_LENGTH };
export const OTP_TTL_MS = 5 * 60 * 1000;

/**
 * Attempts allowed against a single challenge before it is dead.
 *
 * With {@link OTP_LENGTH} at six digits this cap and {@link OTP_MAX_PER_WINDOW} bound an attacker
 * to 9 guesses per 5 minutes against a space of 1,000,000, for a number they do not control.
 * Widening either number, or shortening the code, changes that arithmetic directly.
 */
export const OTP_MAX_ATTEMPTS = 3;

/** Codes issuable per phone within {@link OTP_RATE_WINDOW_MS}. */
export const OTP_MAX_PER_WINDOW = 3;
export const OTP_RATE_WINDOW_MS = 5 * 60 * 1000;

function pepper(): string {
  const value = process.env.OTP_HMAC_PEPPER;
  if (!value || value.length < 32) {
    // Fail closed. A missing pepper would silently degrade the stored HMAC to something
    // brute-forceable in microseconds — exactly the property this is meant to prevent.
    throw new Error('OTP_HMAC_PEPPER is missing or too short (want 32+ chars)');
  }
  return value;
}

/**
 * When a code issued now stops being valid.
 *
 * Extracted from the request route so the window is a value that can be asserted on rather than
 * an expression buried in an insert. The database is still what enforces it — `verify-otp`
 * filters on `expires_at > now()`, which is the clock that matters — but a rule nothing can test
 * is a rule that drifts.
 */
export function otpExpiresAt(nowMs: number = Date.now()): Date {
  return new Date(nowMs + OTP_TTL_MS);
}

/** The same judgement the verify query makes, for callers that already hold the timestamp. */
export function isOtpExpired(expiresAt: Date | string, nowMs: number = Date.now()): boolean {
  const at = expiresAt instanceof Date ? expiresAt : new Date(expiresAt);
  return !(at.getTime() > nowMs);
}

/** Cryptographically random numeric code, zero-padded to {@link OTP_LENGTH}. */
export function generateOtpCode(): string {
  const max = 10 ** OTP_LENGTH;
  return randomInt(0, max).toString().padStart(OTP_LENGTH, '0');
}

/**
 * HMAC of a code, bound to the phone hash so a code captured for one number cannot be replayed
 * against another (the stored digest differs even for identical digits).
 */
export function hashOtpCode(code: string, phoneHash: string): string {
  return createHmac('sha256', pepper()).update(`${phoneHash}:${code}`).digest('hex');
}

/** Constant-time digest comparison. Never use `===` on these. */
export function otpMatches(code: string, phoneHash: string, storedHmac: string): boolean {
  const expected = Buffer.from(hashOtpCode(code, phoneHash), 'hex');
  let actual: Buffer;
  try {
    actual = Buffer.from(storedHmac, 'hex');
  } catch {
    return false;
  }
  // timingSafeEqual throws on length mismatch, which would itself be a timing signal.
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(expected, actual);
}

/** Shape check before the code ever reaches the database. */
export function isWellFormedOtp(value: unknown): value is string {
  return typeof value === 'string' && new RegExp(`^\\d{${OTP_LENGTH}}$`).test(value);
}
