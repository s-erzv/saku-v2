/**
 * Resolve a phone number to the wallet address that should receive a transfer.
 *
 * This is unavoidably an "is this number on Saku?" oracle — you cannot send to someone without
 * learning where to send. What it does not do is leak anything beyond that: no phone number
 * comes back (the caller already has it), the reply carries a display name, a profile picture
 * and an address and nothing else, and it costs a verified session plus a rate-limit slot per
 * lookup.
 *
 * The number is hashed here and never stored. Same hash function as the escrow's
 * `recipientPhoneHash` (`lib/phone.ts`).
 */

import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { getSession, unauthorized } from '@/lib/session';
import { InvalidPhoneNumberError, phoneHashCandidates } from '@/lib/phone';
import { findUserByPhone } from '@/lib/phone-identity';
import { CHAIN_ID } from '@/lib/chain';
import { checkRateLimit, RATE_LIMITS } from '@/lib/rate-limiter';
import { clientKey } from '@/lib/request-meta';

export async function POST(request: Request) {
  const session = await getSession(request);
  if (!session) return unauthorized();

  if (!(await checkRateLimit(`resolve:${session.userId}`, RATE_LIMITS.RESOLVE)).allowed) {
    return NextResponse.json({ error: 'Too many lookups. Try again shortly.' }, { status: 429 });
  }

  let rawPhone: string;
  let dialCode: string;
  try {
    const body = await request.json();
    dialCode = body.countryCode || '62';
    // Validates the shape and rejects early; the value itself is recomputed by the lookup below.
    phoneHashCandidates(body.phone, dialCode);
    rawPhone = body.phone;
  } catch (error) {
    if (error instanceof InvalidPhoneNumberError) {
      return NextResponse.json({ error: 'Invalid phone number' }, { status: 400 });
    }
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }

  // Both hashes, because the session's own hash is whichever version its row still holds. A
  // caller on version 1 typing their own number would otherwise compare a version 2 hash against
  // a version 1 session, miss, and be told to send money to themselves.
  if (phoneHashCandidates(rawPhone, dialCode).some((c) => c.hash === session.phoneHash)) {
    return NextResponse.json({ error: 'That is your own number' }, { status: 400 });
  }

  try {
    const supabase = getSupabaseAdmin();

    // Falls back to the unkeyed hash, so a recipient who has not signed in since the pepper
    // landed is still findable. Without it they would read as "not on Saku" and the sender
    // would be pushed into an off-ramp they do not need.
    const lookup = await findUserByPhone<{
      id: string;
      display_name: string | null;
      avatar_url: string | null;
    }>(supabase, rawPhone, dialCode, 'id, display_name, avatar_url');
    const recipient = lookup.user;

    // The hash the recipient's row actually holds, not simply the newest one. The caller writes
    // this into the transfer record and into the escrow's `recipientPhoneHash`, and both have to
    // agree with the database until this account migrates — which rewrites those rows too.
    const recipientPhoneHash =
      lookup.matchedVersion === 1 ? lookup.legacyHash : lookup.currentHash;

    if (!recipient) {
      return NextResponse.json({ found: false, reason: 'not_registered' });
    }

    const { data: wallet } = await supabase
      .from('wallets')
      .select('address')
      .eq('user_id', recipient.id)
      .eq('chain_id', CHAIN_ID)
      .maybeSingle();

    // Registered but no wallet: the account exists and MPC setup never finished. Transferring
    // on-chain needs an address, so this is a distinct case from "not on Saku" and the UI says
    // so rather than pretending the number is unknown.
    if (!wallet?.address) {
      return NextResponse.json({ found: false, reason: 'no_wallet' });
    }

    return NextResponse.json({
      found: true,
      address: wallet.address,
      displayName: recipient.display_name,
      // So the sender sees who they are paying rather than a generic disc. It reveals nothing a
      // name does not: the caller already holds the number and has already been told the account
      // exists, which is what this route is for.
      avatarUrl: recipient.avatar_url,
      phoneHash: recipientPhoneHash,
    });
  } catch {
    return NextResponse.json({ error: 'Could not look up that number' }, { status: 500 });
  }
}
