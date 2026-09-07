/**
 * Verify an OTP and issue a Saku session token.
 *
 * What this route no longer does, and why that is the point of v2: it does not create a wallet,
 * does not generate or store a private key, and does not touch an admin wallet. Key material is
 * produced client-side by the MPC layer after this token is issued (PRD 5.1 step 3). A full
 * compromise of this route yields a session, not anyone's funds.
 */

import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { hashPhone, InvalidPhoneNumberError } from '@/lib/phone';
import { countryFromDialCode } from '@/lib/currency';
import { otpMatches, isWellFormedOtp, OTP_MAX_ATTEMPTS } from '@/lib/otp';
import { generateToken } from '@/lib/jwt';
import { rateLimiter, RATE_LIMITS } from '@/lib/rate-limiter';
import { extractClientIP } from '@/lib/auth-middleware';

/**
 * One message for every failure mode: wrong code, expired code, no code ever requested,
 * attempts exhausted. Distinguishing them tells an attacker which numbers are worth attacking
 * and when a fresh code is in flight.
 */
const INVALID_OTP = { error: 'Verification code is incorrect or has expired', code: 'INVALID_OTP' };

export async function POST(request: Request) {
  let phoneHash: string;
  let otp: string;
  let countryCode: string;

  try {
    const body = await request.json();
    if (!isWellFormedOtp(body.otp)) {
      return NextResponse.json(INVALID_OTP, { status: 400 });
    }
    otp = body.otp;
    phoneHash = hashPhone(body.phone, body.countryCode || '62');
    // The dialing prefix is the only signal Saku has for where a user is, and the country
    // decides which currency they are later billed in (PRD Section 6). Recorded once, at
    // signup; it was defaulting to 'ID' for everyone before.
    countryCode = countryFromDialCode(body.countryCode || '62');
  } catch (error) {
    if (error instanceof InvalidPhoneNumberError) {
      return NextResponse.json({ error: 'Invalid phone number' }, { status: 400 });
    }
    return NextResponse.json(INVALID_OTP, { status: 400 });
  }

  const clientIP = extractClientIP(request) || 'unknown';
  if (!rateLimiter.check(`ip:${clientIP}`, RATE_LIMITS.IP_BASED).allowed) {
    return NextResponse.json({ error: 'Too many attempts' }, { status: 429 });
  }

  try {
    const supabase = getSupabaseAdmin();

    const { data: challenge, error: fetchError } = await supabase
      .from('otp_challenges')
      .select('id, code_hmac, attempt_count')
      .eq('phone_hash', phoneHash)
      .is('consumed_at', null)
      .gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (fetchError) throw fetchError;
    if (!challenge) return NextResponse.json(INVALID_OTP, { status: 400 });

    if (challenge.attempt_count >= OTP_MAX_ATTEMPTS) {
      await supabase
        .from('otp_challenges')
        .update({ consumed_at: new Date().toISOString() })
        .eq('id', challenge.id);
      return NextResponse.json(INVALID_OTP, { status: 400 });
    }

    // Count the attempt before checking the code, and make the write conditional on the value
    // we read. If two requests race, only one increment lands and the loser is rejected — so
    // the cap cannot be bypassed by firing guesses in parallel. v1 had no persistent counter at
    // all: its limiter was an in-process Map, which on serverless means a fresh, empty limit
    // for every cold start and every concurrent instance.
    const { data: claimed, error: claimError } = await supabase
      .from('otp_challenges')
      .update({ attempt_count: challenge.attempt_count + 1 })
      .eq('id', challenge.id)
      .eq('attempt_count', challenge.attempt_count)
      .is('consumed_at', null)
      .select('id')
      .maybeSingle();

    if (claimError) throw claimError;
    if (!claimed) return NextResponse.json(INVALID_OTP, { status: 400 });

    if (!otpMatches(otp, phoneHash, challenge.code_hmac)) {
      return NextResponse.json(INVALID_OTP, { status: 400 });
    }

    // Single-use: burn it before doing anything else, so a replay of the same request cannot
    // ride the same challenge.
    await supabase
      .from('otp_challenges')
      .update({ consumed_at: new Date().toISOString() })
      .eq('id', challenge.id);

    const { data: existing, error: lookupError } = await supabase
      .from('users')
      .select('id')
      .eq('phone_hash', phoneHash)
      .maybeSingle();

    if (lookupError) throw lookupError;

    let userId = existing?.id;
    const isNewUser = !userId;

    if (!userId) {
      const { data: created, error: createError } = await supabase
        .from('users')
        .insert({ phone_hash: phoneHash, country_code: countryCode })
        .select('id')
        .single();

      if (createError) throw createError;
      userId = created.id;
    } else {
      await supabase
        .from('users')
        .update({ last_seen_at: new Date().toISOString() })
        .eq('id', userId);
    }

    // The user exists; the wallet does not yet. The client logs in to the MPC layer with
    // `/api/mpc/id-token` and registers the resulting address afterwards.
    const { data: wallet } = await supabase
      .from('wallets')
      .select('address')
      .eq('user_id', userId)
      .eq('chain_id', Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 97))
      .maybeSingle();

    return NextResponse.json({
      success: true,
      token: await generateToken({ phoneHash, userId }),
      isNewUser,
      walletAddress: wallet?.address ?? null,
      needsWalletSetup: !wallet,
    });
  } catch {
    return NextResponse.json({ error: 'Verification failed' }, { status: 500 });
  }
}
