/**
 * Sign a raw Ethereum transaction with the caller's Turnkey wallet.
 *
 * This is the entire trust boundary of the new key-management model: the sub-organization id
 * used to sign comes from `wallets`, keyed by the session's `user_id` — never from the request
 * body — so a caller can only ever sign with their own wallet. Nothing else gates this, which is
 * the trade PRD Fase 4's revision accepts: a valid Saku session is now sufficient to produce a
 * signature, the same way it was sufficient to release a Web3Auth network share. What's
 * different is who is trusted to check that — this server, instead of Web3Auth's node network.
 */

import { NextResponse } from 'next/server';
import { verifyToken, extractTokenFromHeader } from '@/lib/jwt';
import { signWithWallet } from '@/lib/turnkey';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { CHAIN_ID } from '@/lib/chain';
import { rateLimiter, RATE_LIMITS } from '@/lib/rate-limiter';
import { extractClientIP } from '@/lib/auth-middleware';

const HEX_TX = /^(0x)?[0-9a-fA-F]+$/;

export async function POST(request: Request) {
  const sessionToken = extractTokenFromHeader(request.headers.get('authorization'));
  if (!sessionToken) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let session;
  try {
    session = await verifyToken(sessionToken);
  } catch {
    return NextResponse.json({ error: 'Invalid or expired session' }, { status: 401 });
  }

  const clientIP = extractClientIP(request) || 'unknown';
  // Signing, not just reading — the tighter of the two rate limits applies.
  const ipRateLimit = rateLimiter.check(`ip:${clientIP}`, RATE_LIMITS.IP_BASED);
  if (!ipRateLimit.allowed) {
    return NextResponse.json({ error: 'Too many requests from your device.' }, { status: 429 });
  }

  try {
    const body = await request.json();
    const unsignedTransaction = String(body.unsignedTransaction ?? '');
    if (!unsignedTransaction || !HEX_TX.test(unsignedTransaction)) {
      return NextResponse.json({ error: 'Invalid unsigned transaction' }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();
    const { data: wallet, error } = await supabase
      .from('wallets')
      .select('address, turnkey_sub_org_id')
      .eq('user_id', session.userId)
      .eq('chain_id', CHAIN_ID)
      .maybeSingle();

    if (error) throw error;
    if (!wallet?.turnkey_sub_org_id) {
      return NextResponse.json({ error: 'No wallet provisioned for this session' }, { status: 409 });
    }

    const signedTransaction = await signWithWallet(
      wallet.turnkey_sub_org_id,
      wallet.address,
      unsignedTransaction
    );

    return NextResponse.json({ signedTransaction });
  } catch (err) {
    console.error('[mpc/sign] failed:', err);
    return NextResponse.json({ error: 'Failed to sign transaction' }, { status: 500 });
  }
}
