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
  OTP_TTL_MS,
  OTP_MAX_PER_WINDOW,
  OTP_RATE_WINDOW_MS,
} from '@/lib/otp';
import { rateLimiter, RATE_LIMITS } from '@/lib/rate-limiter';
import { extractClientIP } from '@/lib/auth-middleware';

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

  // Best-effort first line only. `x-forwarded-for` is client-supplied and this counter lives in
  // one process's memory, so it resets on cold start and is not shared between instances. The
  // limit that actually holds is the per-phone one below, which is in the database.
  const clientIP = extractClientIP(request) || 'unknown';
  if (!rateLimiter.check(`ip:${clientIP}`, RATE_LIMITS.IP_BASED).allowed) {
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

    const code = generateOtpCode();
    const { data: challenge, error: insertError } = await supabase
      .from('otp_challenges')
      .insert({
        phone_hash: phoneHash,
        code_hmac: hashOtpCode(code, phoneHash),
        expires_at: new Date(Date.now() + OTP_TTL_MS).toISOString(),
      })
      .select('id')
      .single();

    if (insertError) throw insertError;

    const delivered = await sendWhatsApp(normalized, code);
    if (!delivered) {
      // Do not leave a live code behind for a message that never arrived — it would burn one of
      // the user's three attempts in the window and stay guessable for five minutes.
      await supabase.from('otp_challenges').delete().eq('id', challenge.id);
      return NextResponse.json({ error: GENERIC_ERROR }, { status: 502 });
    }

    // Deliberately says nothing about whether this number is already registered.
    return NextResponse.json({ success: true, message: 'Verification code sent' });
  } catch {
    return NextResponse.json({ error: GENERIC_ERROR }, { status: 500 });
  }
}

/**
 * Hand the code to the WhatsApp gateway. This is the only place in Saku that touches a plain
 * phone number, and it does not persist it.
 */
async function sendWhatsApp(normalizedPhone: string, code: string): Promise<boolean> {
  const token = process.env.FONNTE_TOKEN?.trim();
  if (!token) return false;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);

  try {
    const response = await fetch('https://api.fonnte.com/send', {
      method: 'POST',
      signal: controller.signal,
      headers: { Authorization: token, Accept: 'application/json' },
      body: new URLSearchParams({
        target: normalizedPhone,
        message:
          `*[ SAKU ]*\n\nYour verification code is: *${code}*\n\n` +
          'Do not share this code with anyone. It expires in 5 minutes.',
      }),
    });

    if (!response.ok) return false;
    const result = await response.json();
    return Boolean(result?.status);
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}
