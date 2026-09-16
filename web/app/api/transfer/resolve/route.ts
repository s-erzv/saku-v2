/**
 * Resolve a phone number or an owner-scoped saved contact to a recipient wallet address.
 *
 * This is unavoidably an "is this number on Saku?" oracle — you cannot send to someone without
 * learning where to send. What it does not do is leak anything beyond that: no phone number comes
 * back, a saved contact ID is accepted only with its owner ID, and every path costs a verified
 * session plus a rate-limit slot.
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

interface RecipientRecord {
  id: string;
  display_name: string | null;
  avatar_url: string | null;
  phone_hash: string;
}

type RecipientLookup =
  | { contactId: string }
  | { phone: string; countryCode: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(request: Request) {
  const session = await getSession(request);
  if (!session) return unauthorized();

  if (!(await checkRateLimit(`resolve:${session.userId}`, RATE_LIMITS.RESOLVE)).allowed) {
    return NextResponse.json({ error: 'Too many lookups. Try again shortly.' }, { status: 429 });
  }

  let lookup: RecipientLookup;
  try {
    const body = await request.json();

    if (typeof body.contactId === 'string') {
      if (!UUID.test(body.contactId)) {
        return NextResponse.json({ error: 'Invalid contact' }, { status: 400 });
      }
      lookup = { contactId: body.contactId };
    } else {
      const countryCode = body.countryCode || '62';
      // Validates the shape and rejects early; the value itself is recomputed by the lookup below.
      phoneHashCandidates(body.phone, countryCode);
      lookup = { phone: body.phone, countryCode };
    }
  } catch (error) {
    if (error instanceof InvalidPhoneNumberError) {
      return NextResponse.json({ error: 'Invalid phone number' }, { status: 400 });
    }
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }

  try {
    const supabase = getSupabaseAdmin();
    let recipient: RecipientRecord | null;
    let recipientPhoneHash: string;

    if ('contactId' in lookup) {
      // `contactId` is never sufficient on its own. The owner predicate is required because the
      // admin client bypasses RLS and contact UUIDs must not become a cross-account lookup key.
      const { data: contact, error: contactError } = await supabase
        .from('contacts')
        .select('contact_phone_hash, contact_user_id')
        .eq('id', lookup.contactId)
        .eq('owner_id', session.userId)
        .maybeSingle();

      if (contactError) throw contactError;
      if (!contact) {
        return NextResponse.json({ error: 'Contact not found' }, { status: 404 });
      }
      if (
        contact.contact_user_id === session.userId ||
        contact.contact_phone_hash === session.phoneHash
      ) {
        return NextResponse.json({ error: 'That is your own number' }, { status: 400 });
      }

      // Prefer the stable FK recorded when the contact was saved. For contacts saved before the
      // recipient joined Saku, fall back to the hash so they become usable without being re-added.
      const recipientQuery = supabase
        .from('users')
        .select('id, display_name, avatar_url, phone_hash');
      const { data, error } = contact.contact_user_id
        ? await recipientQuery.eq('id', contact.contact_user_id).maybeSingle()
        : await recipientQuery.eq('phone_hash', contact.contact_phone_hash).maybeSingle();

      if (error) throw error;
      recipient = data as RecipientRecord | null;
      recipientPhoneHash = recipient?.phone_hash ?? contact.contact_phone_hash;
    } else {
      // Both hashes, because the session's own hash is whichever version its row still holds. A
      // caller on version 1 typing their own number would otherwise compare a version 2 hash
      // against a version 1 session, miss, and be told to send money to themselves.
      if (
        phoneHashCandidates(lookup.phone, lookup.countryCode).some(
          (candidate) => candidate.hash === session.phoneHash
        )
      ) {
        return NextResponse.json({ error: 'That is your own number' }, { status: 400 });
      }

      // Falls back to the unkeyed hash, so a recipient who has not signed in since the pepper
      // landed is still findable. Without it they would read as "not on Saku" and the sender
      // would be pushed into an off-ramp they do not need.
      const phoneLookup = await findUserByPhone<RecipientRecord>(
        supabase,
        lookup.phone,
        lookup.countryCode,
        'id, display_name, avatar_url, phone_hash'
      );
      recipient = phoneLookup.user;

      // The hash the recipient's row actually holds, not simply the newest one. The caller writes
      // this into the transfer record and both have to agree until the account migrates.
      recipientPhoneHash =
        phoneLookup.matchedVersion === 1 ? phoneLookup.legacyHash : phoneLookup.currentHash;
    }

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
    return NextResponse.json({ error: 'Could not look up that recipient' }, { status: 500 });
  }
}
