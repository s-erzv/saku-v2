/**
 * Issue an OTP for a phone number (PRD Section 1: phone as identity, no plain-text storage).
 *
 * The number is normalized, handed to the WhatsApp gateway, and then dropped. What lands in
 * the database is its keccak256 hash and an HMAC of the code — never the number, never a
 * readable code.
 */

import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { hashPhone, normalizePhone, InvalidPhoneNumberError } from '@/lib/phone';
import {
  generateOtpCode,
  hashOtpCode,
  otpExpiresAt,
  OTP_MAX_PER_WINDOW,
  OTP_RATE_WINDOW_MS,
} from '@/lib/otp';
import { testOtpCodeFor } from '@/lib/otp-test-numbers';
import { checkRateLimit, RATE_LIMITS } from '@/lib/rate-limiter';
import { clientKey } from '@/lib/request-meta';
import { logAuthEvent } from '@/lib/audit-log';
import { sendWhatsApp } from '@/lib/whatsapp';

/** One message for every rejection an attacker could learn something from. */
const GENERIC_ERROR = 'Could not send your verification code. Please try again shortly.';

export async function POST(request: Request) {
  let phoneHash: string;
  let normalized: string;

  try {
    const { phone, countryCode } = await request.json();
    normalized = normalizePhone(phone, countryCode || '62');
    phoneHash = hashPhone(phone, countryCode || '62');
  } catch (error) {
    if (error instanceof InvalidPhoneNumberError) {
      return NextResponse.json({ error: 'Invalid phone number' }, { status: 400 });
    }
    return NextResponse.json({ error: GENERIC_ERROR }, { status: 400 });
  }

  // Both counters are now in the database and both hold. The IP bucket slows one machine
  // sweeping many numbers — keyed on an address the platform vouches for, not on the
  // client-writable first hop of `x-forwarded-for` it used to trust. The per-phone limit below
  // is what protects a single number.
  const ipLimit = await checkRateLimit(clientKey(request, 'request-otp'), RATE_LIMITS.IP_BASED);
  if (!ipLimit.allowed) {
    await logAuthEvent(request, { type: 'otp_request_rate_limited', phoneHash });
    return NextResponse.json({ error: GENERIC_ERROR }, { status: 429 });
  }

  try {
    const supabase = getSupabaseAdmin();
    const windowStart = new Date(Date.now() - OTP_RATE_WINDOW_MS).toISOString();

    const { count, error: countError } = await supabase
      .from('otp_challenges')
      .select('id', { count: 'exact', head: true })
      .eq('phone_hash', phoneHash)
      .gte('created_at', windowStart);

    if (countError) throw countError;
    if ((count ?? 0) >= OTP_MAX_PER_WINDOW) {
      await logAuthEvent(request, { type: 'otp_request_rate_limited', phoneHash, metadata: { scope: 'per-phone' } });
      return NextResponse.json(
        { error: 'Too many code requests. Please wait 5 minutes.', code: 'RATE_LIMIT_EXCEEDED' },
        { status: 429 }
      );
    }

    // Retire any code still live for this number. v1 left every unexpired code valid and looped
    // over all of them at verification time, so each resend handed an attacker another
    // simultaneous guess target. Exactly one code is alive at a time now.
    await supabase
      .from('otp_challenges')
      .update({ consumed_at: new Date().toISOString() })
      .eq('phone_hash', phoneHash)
      .is('consumed_at', null);

    // A test number's code is fixed rather than random; everything after this point — the
    // challenge row, the HMAC, the expiry, the attempt cap, all of `verify-otp` — is identical
    // either way. See `lib/otp-test-numbers.ts` for why this exists and what locks it down.
    const testCode = testOtpCodeFor(normalized);
    const code = testCode ?? generateOtpCode();

    const { data: challenge, error: insertError } = await supabase
      .from('otp_challenges')
      .insert({
        phone_hash: phoneHash,
        code_hmac: hashOtpCode(code, phoneHash),
        expires_at: otpExpiresAt().toISOString(),
      })
      .select('id')
      .single();

    if (insertError) throw insertError;

    if (testCode) {
      console.warn(`[otp] test number ${normalized} — no WhatsApp message sent`);
      await logAuthEvent(request, { type: 'otp_requested', phoneHash, metadata: { channel: 'test-number' } });
      return NextResponse.json({ success: true, message: 'Verification code sent' });
    }

    const outcome = await sendWhatsApp(
      normalized,
      `*[ SAKU ]*\n\nYour verification code is: *${code}*\n\n` +
        'Do not share this code with anyone. It expires in 5 minutes.',
      'otp'
    );
    if (outcome !== 'sent') {
      // Do not leave a live code behind for a message that never arrived — it would burn one of
      // the user's three attempts in the window and stay guessable for five minutes.
      await supabase.from('otp_challenges').delete().eq('id', challenge.id);
      await logAuthEvent(request, { type: 'otp_send_failed', phoneHash, metadata: { outcome } });

      // "This number has no WhatsApp" is safe to say and is the difference between a user
      // retrying a typo and a user concluding the app is broken. It leaks nothing about Saku —
      // only what WhatsApp itself will tell anyone who asks. Every other failure stays generic.
      if (outcome === 'not-on-whatsapp') {
        return NextResponse.json(
          { error: 'That number has no WhatsApp account. Check the number and the country code.' },
          { status: 400 }
        );
      }

      return NextResponse.json({ error: GENERIC_ERROR }, { status: 502 });
    }

    await logAuthEvent(request, { type: 'otp_requested', phoneHash, metadata: { channel: 'whatsapp' } });

    // Deliberately says nothing about whether this number is already registered.
    return NextResponse.json({ success: true, message: 'Verification code sent' });
  } catch {
    return NextResponse.json({ error: GENERIC_ERROR }, { status: 500 });
  }
}
