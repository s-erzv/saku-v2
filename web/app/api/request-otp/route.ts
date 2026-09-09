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
import { testOtpCodeFor } from '@/lib/otp-test-numbers';
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
        expires_at: new Date(Date.now() + OTP_TTL_MS).toISOString(),
      })
      .select('id')
      .single();

    if (insertError) throw insertError;

    if (testCode) {
      console.warn(`[otp] test number ${normalized} — no WhatsApp message sent`);
      return NextResponse.json({ success: true, message: 'Verification code sent' });
    }

    const outcome = await sendWhatsApp(normalized, code);
    if (outcome !== 'sent') {
      // Do not leave a live code behind for a message that never arrived — it would burn one of
      // the user's three attempts in the window and stay guessable for five minutes.
      await supabase.from('otp_challenges').delete().eq('id', challenge.id);

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
type SendOutcome = 'sent' | 'not-on-whatsapp' | 'failed';

/**
 * Turns off the gateway's own number rewriting.
 *
 * Fonnte defaults this to `62` and then "adds the country code if it does not exist" — where
 * "exist" means the target already starts with that exact prefix. Saku normalizes every number
 * to full international digits before it gets here, so for an Indonesian number the default was
 * a no-op and nobody noticed. For everyone else it silently mangled the target: a Malaysian
 * `60811111111` was rewritten to `6260811111111` and queued against a number that does not
 * exist. The send still reported success, so the user was told the code was on its way and
 * nothing ever arrived. `'0'` disables the rewrite and sends the digits exactly as given.
 */
const NO_GATEWAY_REWRITE = '0';

async function sendWhatsApp(normalizedPhone: string, code: string): Promise<SendOutcome> {
  const token = process.env.FONNTE_TOKEN?.trim();
  if (!token) {
    console.error('[otp] FONNTE_TOKEN is not set');
    return 'failed';
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);

  try {
    const response = await fetch('https://api.fonnte.com/send', {
      method: 'POST',
      signal: controller.signal,
      headers: { Authorization: token, Accept: 'application/json' },
      body: new URLSearchParams({
        target: normalizedPhone,
        countryCode: NO_GATEWAY_REWRITE,
        message:
          `*[ SAKU ]*\n\nYour verification code is: *${code}*\n\n` +
          'Do not share this code with anyone. It expires in 5 minutes.',
      }),
    });

    if (!response.ok) {
      console.error('[otp] gateway HTTP', response.status);
      return 'failed';
    }

    const result = await response.json();

    // The gateway echoes back the number it actually queued. If that is not the number we asked
    // for, the message is on its way to a stranger or to nowhere, and reporting success would
    // leave the user waiting for a code that cannot arrive.
    const queued: unknown = result?.target;
    if (result?.status && Array.isArray(queued) && !queued.includes(normalizedPhone)) {
      console.error('[otp] gateway rewrote the target:', JSON.stringify(queued).slice(0, 200));
      return 'failed';
    }

    if (result?.status) return 'sent';

    // The gateway explains itself and this used to be thrown away, leaving every failure —
    // a number with no WhatsApp, an exhausted quota, a disconnected device — as the same
    // silent "something went wrong".
    console.error('[otp] gateway refused:', JSON.stringify(result).slice(0, 300));
    return (await isOnWhatsApp(token, normalizedPhone)) === false ? 'not-on-whatsapp' : 'failed';
  } catch (error) {
    console.error('[otp] gateway unreachable:', error);
    return 'failed';
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Does this number have a WhatsApp account? Asked only to explain a send that already failed,
 * never to decide whether one may go out — the difference matters more than it looks.
 *
 * Gating every login on this answer was tried and reverted. Two reasons. A wrong `not_registered`
 * would lock a real user out of the app permanently, which is a far worse failure than a code
 * that has to be requested twice; and a contact-existence probe on every sign-in is exactly the
 * traffic pattern that gets an unofficial WhatsApp gateway's number banned, which would take
 * every user down at once. A number that truly has no WhatsApp is rare in a wallet people sign
 * up for with their own phone, and the mangled-target bug that looked like this problem is now
 * caught directly, by comparing what the gateway queued against what we asked it to send.
 *
 * Returns null when the check itself could not be completed — "we do not know" and "the number
 * has no WhatsApp" must not collapse into the same answer, or a gateway outage would start
 * telling people their own number does not exist.
 */
async function isOnWhatsApp(token: string, normalizedPhone: string): Promise<boolean | null> {
  try {
    const response = await fetch('https://api.fonnte.com/validate', {
      method: 'POST',
      headers: { Authorization: token, Accept: 'application/json' },
      body: new URLSearchParams({
        target: normalizedPhone,
        countryCode: NO_GATEWAY_REWRITE,
      }),
    });
    if (!response.ok) return null;

    const result = (await response.json()) as {
      status?: boolean;
      registered?: string[];
      not_registered?: string[];
    };
    if (!result?.status) return null;

    if (result.registered?.includes(normalizedPhone)) return true;
    if (result.not_registered?.includes(normalizedPhone)) return false;
    return null;
  } catch {
    return null;
  }
}
