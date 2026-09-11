/**
 * Verify an OTP and open a session.
 *
 * What this route no longer does, and why that is the point of v2: it does not create a wallet,
 * does not generate or store a private key, and does not touch an admin wallet. Key material is
 * held by the signing provider (`lib/privy.ts`); a full compromise of this route yields a
 * session, not anyone's funds.
 *
 * What changed again since: the token is **not returned in the response body**. It is set as an
 * httpOnly cookie, so no page script ever holds it and no script injection can lift it. See
 * `lib/session.ts`.
 *
 * Why a failed code failed is now said out loud, within limits. A stale code says it is stale
 * rather than sending someone to retype the same digits until the attempt cap locks them out,
 * and a wrong code says how many tries are left. Expired and never-requested still answer
 * identically, which is what stops this being a probe for whether a login is in flight. The
 * whole argument is in `lib/otp-message.ts`.
 */

import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { CURRENT_PHONE_HASH_VERSION, hashPhone, InvalidPhoneNumberError, phoneHint } from '@/lib/phone';
import { findUserByPhone, upgradePhoneHashIfNeeded } from '@/lib/phone-identity';
import { countryFromDialCode } from '@/lib/currency';
import { isWellFormedOtp } from '@/lib/otp';
import { consumeOtpChallenge, type OtpFailureReason } from '@/lib/otp-challenge';
import { MALFORMED_OTP, otpFailureMessage } from '@/lib/otp-message';
import { generateToken } from '@/lib/jwt';
import { setSessionCookie } from '@/lib/session';
import { checkRateLimit, RATE_LIMITS } from '@/lib/rate-limiter';
import { clientKey } from '@/lib/request-meta';
import { logAuthEvent } from '@/lib/audit-log';


export async function POST(request: Request) {
  let phoneHash: string;
  let otp: string;
  let countryCode: string;
  // Held past the parse because this is the only point in the system where a plaintext number
  // exists. The version 1 to version 2 hash migration below cannot run without it, and there is
  // no later opportunity: the number is never written down.
  let rawPhone: string;
  let dialCode: string;

  try {
    const body = await request.json();
    if (!isWellFormedOtp(body.otp)) {
      return NextResponse.json(MALFORMED_OTP, { status: 400 });
    }
    otp = body.otp;
    rawPhone = body.phone;
    dialCode = body.countryCode || '62';
    phoneHash = hashPhone(body.phone, dialCode);
    // The dialing prefix is the only signal Saku has for where a user is, and the country
    // decides which currency they are later billed in (PRD Section 6). Recorded once, at
    // signup; it was defaulting to 'ID' for everyone before.
    countryCode = countryFromDialCode(body.countryCode || '62');
  } catch (error) {
    if (error instanceof InvalidPhoneNumberError) {
      return NextResponse.json({ error: 'Invalid phone number' }, { status: 400 });
    }
    return NextResponse.json(MALFORMED_OTP, { status: 400 });
  }

  // Two limits, because they stop different things. The IP bucket slows one machine sweeping many
  // numbers; the per-phone attempt counter below — which is in the database, transactional, and
  // cannot be reset by changing address — is what protects a single account.
  const ipLimit = await checkRateLimit(clientKey(request, 'verify-otp'), RATE_LIMITS.IP_BASED);
  if (!ipLimit.allowed) {
    return NextResponse.json({ error: 'Too many attempts' }, { status: 429 });
  }

  try {
    const supabase = getSupabaseAdmin();

    // The attempt cap, the single-use burn, the race handling and the expiry check all live in
    // `lib/otp-challenge.ts`. This route used to carry its own copy of every one of them, which
    // is the duplication that module was extracted to end: recovery got the expiry fix and
    // sign-in would not have.
    const consumed = await consumeOtpChallenge(supabase, phoneHash, otp);

    if (!consumed.ok) {
      // The one event worth watching for a run of. Three of these against one number, over and
      // over, is what a code being guessed looks like from the outside.
      await logAuthEvent(request, {
        type: 'otp_verify_failed',
        phoneHash,
        metadata: { attempt: consumed.attempt, reason: consumed.reason },
      });
      return NextResponse.json(
        otpFailureMessage(consumed.reason as OtpFailureReason, consumed.attemptsLeft),
        { status: 400 }
      );
    }

    // Tries the peppered hash first and falls back to the unkeyed one, because an account that
    // has not signed in since the pepper landed is still filed under version 1 — and nothing
    // could have rewritten it, since its number was never stored.
    const lookup = await findUserByPhone<{ id: string; token_version: number }>(
      supabase,
      rawPhone,
      dialCode,
      'id, token_version'
    );

    const existing = lookup.user;
    const isNewUser = !existing;
    let userId: string;
    let tokenVersion: number;

    // The hash this session will carry. It has to match what the row actually holds: several
    // tables, `split_bill_shares` among them, compare their stored hash directly against the
    // session's to decide what belongs to whom. A session claiming version 2 for a row still on
    // version 1 would hide the user's own split bills from them.
    let sessionPhoneHash = lookup.matchedVersion === 1 ? lookup.legacyHash : lookup.currentHash;

    if (!existing) {
      const { data: created, error: createError } = await supabase
        .from('users')
        .insert({
          phone_hash: lookup.currentHash,
          // Written explicitly because the column defaults to 1 for the benefit of the rows
          // that already existed. A new account has no legacy to declare.
          phone_hash_version: CURRENT_PHONE_HASH_VERSION,
          country_code: countryCode,
        })
        .select('id, token_version')
        .single();

      if (createError) throw createError;
      userId = created.id;
      tokenVersion = created.token_version ?? 0;
      sessionPhoneHash = lookup.currentHash;
    } else {
      // Best effort, and deliberately not allowed to fail the sign-in. If it does not land the
      // account simply stays on version 1, keeps working through the fallback above, and gets
      // another attempt at the next sign-in.
      userId = existing.id;
      tokenVersion = existing.token_version ?? 0;

      const upgrade = await upgradePhoneHashIfNeeded(supabase, {
        userId,
        matchedVersion: lookup.matchedVersion,
        legacyHash: lookup.legacyHash,
        currentHash: lookup.currentHash,
      });

      if (upgrade.upgraded) sessionPhoneHash = lookup.currentHash;

      await supabase
        .from('users')
        .update({ last_seen_at: new Date().toISOString() })
        .eq('id', userId);
    }

    // The dialling code and last four digits, so the profile screen can show the holder which
    // number this account is. This is the only moment a plaintext number exists, so it is the
    // only moment they can be derived — see `phoneHint`.
    //
    // Its own statement, after the row is known to exist, and allowed to fail silently. Folding
    // it into the insert above would mean a sign-up dying outright on a database that has not
    // run `db/migrations/2026-09-11-phone-hint.sql` yet, and no hint is worth breaking sign-in
    // for. An account that misses it here gets another attempt at every later sign-in.
    try {
      const hint = phoneHint(rawPhone, dialCode);
      await supabase
        .from('users')
        .update({ phone_dial_code: hint.dialCode, phone_last4: hint.last4 })
        .eq('id', userId);
    } catch {
      // Deliberately empty: see above.
    }

    // The user exists; the wallet does not yet. The client provisions it with
    // `/api/mpc/provision` immediately after this.
    const { data: wallet } = await supabase
      .from('wallets')
      .select('address')
      .eq('user_id', userId)
      .eq('chain_id', Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 97))
      .maybeSingle();

    await logAuthEvent(request, {
      type: isNewUser ? 'account_created' : 'otp_verify_succeeded',
      phoneHash: sessionPhoneHash,
      userId,
      metadata: { country: countryCode },
    });

    const token = await generateToken({ phoneHash: sessionPhoneHash, userId, version: tokenVersion });

    // The token is in the cookie and nowhere else. Returning it here as well would hand it
    // straight back to page script and undo the reason it is a cookie in the first place.
    return setSessionCookie(
      NextResponse.json({
        success: true,
        isNewUser,
        walletAddress: wallet?.address ?? null,
        needsWalletSetup: !wallet,
      }),
      token
    );
  } catch {
    return NextResponse.json({ error: 'Verification failed' }, { status: 500 });
  }
}
