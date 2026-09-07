/**
 * Resolve a phone number to the wallet address that should receive a transfer.
 *
 * This is unavoidably an "is this number on Saku?" oracle — you cannot send to someone without
 * learning where to send. What it does not do is leak anything beyond that: no phone number
 * comes back (the caller already has it), the reply carries a display name and an address and
 * nothing else, and it costs a verified session plus a rate-limit slot per lookup.
 *
 * The number is hashed here and never stored. Same hash function as the escrow's
 * `recipientPhoneHash` and Web3Auth's `verifierId` (`lib/phone.ts`).
 */

import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { verifyToken, extractTokenFromHeader } from '@/lib/jwt';
import { hashPhone, InvalidPhoneNumberError } from '@/lib/phone';
import { CHAIN_ID } from '@/lib/chain';
import { rateLimiter, RATE_LIMITS } from '@/lib/rate-limiter';
import { extractClientIP } from '@/lib/auth-middleware';

export async function POST(request: Request) {
  const sessionToken = extractTokenFromHeader(request.headers.get('authorization'));
  if (!sessionToken) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let session;
  try {
    session = await verifyToken(sessionToken);
  } catch {
    return NextResponse.json({ error: 'Invalid or expired session' }, { status: 401 });
  }

  const clientIP = extractClientIP(request) || 'unknown';
  if (!rateLimiter.check(`resolve:${clientIP}`, RATE_LIMITS.IP_BASED).allowed) {
    return NextResponse.json({ error: 'Too many lookups. Try again shortly.' }, { status: 429 });
  }

  let phoneHash: string;
  try {
    const body = await request.json();
    phoneHash = hashPhone(body.phone, body.countryCode || '62');
  } catch (error) {
    if (error instanceof InvalidPhoneNumberError) {
      return NextResponse.json({ error: 'Invalid phone number' }, { status: 400 });
    }
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }

  if (phoneHash === session.phoneHash) {
    return NextResponse.json({ error: 'That is your own number' }, { status: 400 });
  }

  try {
    const supabase = getSupabaseAdmin();

    const { data: recipient } = await supabase
      .from('users')
      .select('id, display_name')
      .eq('phone_hash', phoneHash)
      .maybeSingle();

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
      phoneHash,
    });
  } catch {
    return NextResponse.json({ error: 'Could not look up that number' }, { status: 500 });
  }
}
