/**
 * The backup email: add one, see what is on file, take it off.
 *
 * Adding the FIRST address has no cooling period, and the asymmetry is deliberate. A delay on a
 * sensitive change exists to give the old factor time to object; when there is no old factor
 * there is nobody to warn, and the wait would only leave the account unrecoverable for another
 * day. Replacing an address that already exists is a different operation with a different
 * answer, and it lives in the change flow.
 *
 * Removing has no cooling period either, for the mirror reason: it narrows who can reach the
 * account. Delaying it would protect only an attacker who had already put their address here.
 */

import { NextResponse } from 'next/server';

import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { getSession, unauthorized } from '@/lib/session';
import {
  createEmailToken,
  emailTokenExpiresAt,
  encryptEmail,
  hashEmail,
  InvalidEmailError,
  maskEmail,
  normalizeEmail,
} from '@/lib/email';
import { EmailNotConfiguredError, isEmailConfigured, sendEmail } from '@/lib/mailer';
import { checkRateLimit, RATE_LIMITS } from '@/lib/rate-limiter';
import { describeDbError } from '@/lib/db-errors';
import { appOrigin } from '@/lib/app-url';
import { logAuthEvent } from '@/lib/audit-log';

export async function GET(request: Request) {
  const session = await getSession(request);
  if (!session) return unauthorized();

  try {
    const supabase = getSupabaseAdmin();
    const { data: user, error } = await supabase
      .from('users')
      .select('email_ciphertext, email_verified_at')
      .eq('id', session.userId)
      .maybeSingle();

    if (error) throw error;

    // A pending verification is worth showing. Without it the screen says "no email" right after
    // the user added one, which reads as the request having failed.
    const { data: pending } = await supabase
      .from('pending_changes')
      .select('new_value_ciphertext, verify_expires_at')
      .eq('user_id', session.userId)
      .eq('change_type', 'email')
      .is('applied_at', null)
      .is('cancelled_at', null)
      .maybeSingle();

    let masked: string | null = null;
    if (user?.email_ciphertext && user.email_verified_at) {
      const { decryptEmail } = await import('@/lib/email');
      masked = maskEmail(decryptEmail(user.email_ciphertext));
    }

    let pendingMasked: string | null = null;
    if (pending?.new_value_ciphertext) {
      const { decryptEmail } = await import('@/lib/email');
      pendingMasked = maskEmail(decryptEmail(pending.new_value_ciphertext));
    }

    return NextResponse.json({
      email: masked,
      verified: !!user?.email_verified_at,
      pending: pendingMasked,
      // Lets the screen say "email is not set up on this deployment" instead of asking someone
      // to check an inbox nothing was sent to.
      configured: isEmailConfigured(),
    });
  } catch (error) {
    const { message } = describeDbError(error, 'Could not load your email settings');
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const session = await getSession(request);
  if (!session) return unauthorized();

  if (!(await checkRateLimit(`email-add:${session.userId}`, RATE_LIMITS.OTP_REQUEST)).allowed) {
    return NextResponse.json({ error: 'Too many attempts. Try again in a few minutes.' }, { status: 429 });
  }

  let address: string;
  try {
    const body = await request.json();
    address = normalizeEmail(body.email);
  } catch (error) {
    if (error instanceof InvalidEmailError) {
      return NextResponse.json({ error: 'That does not look like an email address' }, { status: 400 });
    }
    return NextResponse.json({ error: 'An email address is required' }, { status: 400 });
  }

  try {
    const supabase = getSupabaseAdmin();

    const { data: user, error: userError } = await supabase
      .from('users')
      .select('email_verified_at')
      .eq('id', session.userId)
      .maybeSingle();

    if (userError) throw userError;

    if (user?.email_verified_at) {
      return NextResponse.json(
        { error: 'This account already has a backup email. Change it instead.', code: 'ALREADY_SET' },
        { status: 409 }
      );
    }

    const emailHash = hashEmail(address);

    // Only verified addresses reserve the namespace, so this catches the real conflict without
    // letting anyone park on someone else's address by typing it into their own form.
    const { data: taken } = await supabase
      .from('users')
      .select('id')
      .eq('email_hash', emailHash)
      .not('email_verified_at', 'is', null)
      .maybeSingle();

    if (taken && taken.id !== session.userId) {
      return NextResponse.json(
        { error: 'That address is already the backup for another account' },
        { status: 409 }
      );
    }

    const verify = createEmailToken();
    const cancel = createEmailToken();
    const now = new Date();

    // Replaces any earlier unverified attempt rather than stacking, so the newest link is the
    // only one that works and an abandoned attempt cannot be resurrected later.
    await supabase
      .from('pending_changes')
      .update({ cancelled_at: now.toISOString(), updated_at: now.toISOString() })
      .eq('user_id', session.userId)
      .eq('change_type', 'email')
      .is('applied_at', null)
      .is('cancelled_at', null);

    const { error: insertError } = await supabase.from('pending_changes').insert({
      user_id: session.userId,
      change_type: 'email',
      old_value_hash: null,
      new_value_hash: emailHash,
      new_value_ciphertext: encryptEmail(address),
      verify_token_hash: verify.hash,
      verify_expires_at: emailTokenExpiresAt(now.getTime()).toISOString(),
      cancel_token_hash: cancel.hash,
      // No wait. There is no existing address to warn, so a delay would protect nobody and
      // leave the account unrecoverable for another day.
      effective_at: now.toISOString(),
    });

    if (insertError) throw insertError;

    const link = `${appOrigin(request)}/api/account/email/verify?token=${verify.token}`;

    await sendEmail({
      to: address,
      subject: 'Confirm your Saku backup email',
      text:
        'Someone added this address as the backup email for a Saku account.\n\n' +
        `Confirm it here:\n${link}\n\n` +
        'The link works once and expires in an hour.\n\n' +
        'If this was not you, ignore this message. Nothing changes until the link is opened.',
    });

    return NextResponse.json({ sent: true, to: maskEmail(address) }, { status: 202 });
  } catch (error) {
    if (error instanceof EmailNotConfiguredError) {
      return NextResponse.json(
        { error: 'Email is not set up on this deployment yet', code: 'NOT_CONFIGURED' },
        { status: 503 }
      );
    }
    const { message } = describeDbError(error, 'Could not send that confirmation');
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  const session = await getSession(request);
  if (!session) return unauthorized();

  try {
    const supabase = getSupabaseAdmin();
    const now = new Date().toISOString();

    const { error } = await supabase
      .from('users')
      .update({ email_hash: null, email_ciphertext: null, email_verified_at: null, updated_at: now })
      .eq('id', session.userId);

    if (error) throw error;

    await supabase
      .from('pending_changes')
      .update({ cancelled_at: now, updated_at: now })
      .eq('user_id', session.userId)
      .eq('change_type', 'email')
      .is('applied_at', null)
      .is('cancelled_at', null);

    await logAuthEvent(request, { type: 'backup_email_removed', userId: session.userId });

    return NextResponse.json({ removed: true });
  } catch (error) {
    const { message } = describeDbError(error, 'Could not remove that email');
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
