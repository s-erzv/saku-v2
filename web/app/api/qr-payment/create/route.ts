/**
 * Create a payment request — the thing a QR code points at.
 *
 * v1 built a `qrHash` out of a plain phone number and an amount and returned it unstored, which
 * meant the QR carried the merchant's number and nothing could be looked up afterwards. This
 * stores a short code instead: the QR holds the code, the code resolves to an address and an
 * amount, and no phone number is involved at any point.
 *
 * Nothing is custodied. The payer signs a normal transfer straight to the payee's wallet; this
 * row exists so both sides can see the outcome.
 */

import { NextResponse } from 'next/server';
import { parseUnits } from 'ethers';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { getSession, unauthorized } from '@/lib/session';
import { CHAIN_ID, USDC_DECIMALS, getUsdcAddress } from '@/lib/chain';
import { generatePacketCode } from '@/lib/packet';
import { describeDbError } from '@/lib/db-errors';

/** A request that sits unpaid this long stops being scannable. */
const EXPIRY_MINUTES = 60;

export async function POST(request: Request) {
  const session = await getSession(request);
  if (!session) return unauthorized();

  try {
    const body = await request.json();

    // An open amount is legitimate — a tip jar, or a bill the payer fills in.
    let amount: bigint | null = null;
    if (body.amount !== undefined && body.amount !== null && body.amount !== '') {
      const value = Number(body.amount);
      if (!Number.isFinite(value) || value <= 0) {
        return NextResponse.json({ error: 'Invalid amount' }, { status: 400 });
      }
      amount = parseUnits(value.toFixed(USDC_DECIMALS), USDC_DECIMALS);
    }

    const supabase = getSupabaseAdmin();

    const { data: wallet } = await supabase
      .from('wallets')
      .select('address')
      .eq('user_id', session.userId)
      .eq('chain_id', CHAIN_ID)
      .maybeSingle();

    if (!wallet?.address) {
      return NextResponse.json({ error: 'Finish setting up your wallet first' }, { status: 400 });
    }

    const { data, error } = await supabase
      .from('payment_requests')
      .insert({
        code: generatePacketCode(10),
        payee_id: session.userId,
        // Snapshotted: the QR should keep pointing where it pointed when it was made, even if
        // the wallet record changes later.
        payee_address: wallet.address.toLowerCase(),
        amount: amount ? amount.toString() : null,
        token_address: getUsdcAddress().toLowerCase(),
        note: typeof body.note === 'string' ? body.note.slice(0, 140) : null,
        expires_at: new Date(Date.now() + EXPIRY_MINUTES * 60_000).toISOString(),
      })
      .select('code, amount, note, expires_at')
      .single();

    if (error) throw error;

    return NextResponse.json({ success: true, request: data });
  } catch (error) {
    const { message, isSchemaDrift, code } = describeDbError(error, 'Could not create the request');
    console.error('[qr-payment/create]', code ?? '', message);
    return NextResponse.json({ error: message, schemaOutOfDate: isSchemaDrift || undefined }, { status: 500 });
  }
}
