/**
 * Phone numbers that receive their OTP without WhatsApp being involved at all.
 *
 * Saku's only delivery channel is a real WhatsApp account, so there is no such thing as a fake
 * number that can receive a code — a made-up target is silence, and pointing the gateway at a
 * stranger's real number to watch it work means messaging someone who never asked. That leaves
 * no way to walk the signup flow as a Malaysian or Singaporean user, which is the one path that
 * decides `users.country_code` and therefore every currency the account is quoted in afterwards.
 * These numbers exist to make that path walkable. Firebase Auth and Twilio Verify both ship the
 * same idea for the same reason.
 *
 * What this deliberately does NOT do is weaken verification. A test number still gets a real row
 * in `otp_challenges`, still stores an HMAC of its code, and still goes through the same
 * expiry, single-use and attempt-cap checks in `verify-otp`. The only thing skipped is the
 * gateway call, and the only thing special about the code is that it is fixed instead of random.
 * `verify-otp` needs no knowledge of any of this and has none.
 *
 * It is still an authentication bypass, so it is locked twice over: {@link OTP_TEST_NUMBERS_ENV}
 * has to be set at all, and {@link isProductionRuntime} has to be false. Setting the variable in
 * production does nothing except log an error.
 */

import { OTP_LENGTH } from '@/lib/otp';

/** `<international digits>:<code>`, comma-separated. Example: `60123456789:123456,6591234567:567890`. */
export const OTP_TEST_NUMBERS_ENV = 'OTP_TEST_NUMBERS';

/**
 * Preview deployments are a legitimate place to exercise a signup flow, and Next sets
 * `NODE_ENV=production` for every build including those — so `NODE_ENV` alone would switch this
 * off exactly where it is most useful. `VERCEL_ENV` is the value that distinguishes a preview
 * from the real thing, and it is trusted first when present.
 *
 * A self-hosted `next start` has no `VERCEL_ENV`, so it falls back to `NODE_ENV` and stays off.
 * Both branches fail closed: anything that is not recognisably not-production counts as
 * production.
 */
function isProductionRuntime(): boolean {
  const vercelEnv = process.env.VERCEL_ENV;
  if (vercelEnv) return vercelEnv === 'production';
  return process.env.NODE_ENV === 'production';
}

/**
 * The fixed code for a test number, or null if this is not one.
 *
 * @param normalizedPhone Full international digits, as produced by `lib/phone.ts`. Comparing
 *        anything less normalized would let the same number match or miss depending on how the
 *        caller happened to type it.
 */
export function testOtpCodeFor(normalizedPhone: string): string | null {
  const raw = process.env[OTP_TEST_NUMBERS_ENV]?.trim();
  if (!raw) return null;

  if (isProductionRuntime()) {
    // Loud, and on every request, because the alternative is a production deployment carrying a
    // set of numbers whose owner believes they are inert.
    console.error(`[otp] ${OTP_TEST_NUMBERS_ENV} is set in production and is being ignored`);
    return null;
  }

  const wantedCode = new RegExp(`^\\d{${OTP_LENGTH}}$`);

  for (const entry of raw.split(',')) {
    const [phonePart, codePart] = entry.split(':');
    const phone = phonePart?.replace(/\D/g, '');
    const code = codePart?.trim();

    // A malformed entry is skipped rather than throwing. One typo in the variable should not
    // take the whole login route down for every real user on the deployment.
    if (!phone || !code || !wantedCode.test(code)) continue;
    if (phone === normalizedPhone) return code;
  }

  return null;
}
