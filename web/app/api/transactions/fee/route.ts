/**
 * Fill in the platform fee's transaction hash on a row that was recorded without it.
 *
 * The fee is a second transfer sent after the one the user cared about (`lib/platform-fee.ts`
 * explains why it follows rather than leads). Routes that record a payment used to be called only
 * once the fee had been broadcast, so the hash could travel with them — which meant every packet
 * and every split-bill share waited on Saku's own bookkeeping before the screen could say the
 * payment had gone through.
 *
 * Now those routes are called the moment the payment confirms, and the fee follows behind the
 * success screen. This is where its hash catches up.
 *
 * What is written here is the same untrusted value it always was: `fee_tx_hash` is kept for
 * tracing and is explicitly never treated as proof that a fee was paid (see `feeHashFrom` in
 * `/api/transfer/record`). So this does not verify a receipt. What it does do is refuse to
 * overwrite: the update only matches a row belonging to the caller whose `fee_tx_hash` is still
 * null, so a hash that is already recorded cannot be replaced by a later caller, and no session
 * can touch another account's history.
 */

import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { getSession, unauthorized } from '@/lib/session';
import { CHAIN_ID } from '@/lib/chain';

const TX_HASH = /^0x[0-9a-fA-F]{64}$/;

/** PostgREST reports an unknown column as PGRST204; Postgres itself as 42703. */
const UNKNOWN_COLUMN = new Set(['PGRST204', '42703']);

export async function POST(request: Request) {
  const session = await getSession(request);
  if (!session) return unauthorized();

  try {
    const body = await request.json();
    const txHash = String(body.txHash ?? '');
    const feeTxHash = String(body.feeTxHash ?? '');

    if (!TX_HASH.test(txHash) || !TX_HASH.test(feeTxHash)) {
      return NextResponse.json({ error: 'Invalid transaction hash' }, { status: 400 });
    }

    const { error } = await getSupabaseAdmin()
      .from('transactions')
      .update({ fee_tx_hash: feeTxHash.toLowerCase() })
      .eq('chain_id', CHAIN_ID)
      .eq('tx_hash', txHash.toLowerCase())
      .eq('user_id', session.userId)
      .is('fee_tx_hash', null);

    if (error) {
      // A database without the fee columns yet is the same degradation `recordTransaction`
      // already tolerates: the payment is recorded, the fee reference is not, and neither is
      // worth failing a request the user is not waiting on.
      if (UNKNOWN_COLUMN.has(error.code ?? '')) {
        console.warn('[transactions/fee] fee columns not migrated yet; nothing to fill in');
        return NextResponse.json({ success: true, updated: false });
      }
      throw error;
    }

    // Deliberately not reporting whether a row matched. The payment row may not be written yet,
    // may already carry a hash, or may belong to a flow that never records one — none of which
    // is a problem the caller can or should do anything about.
    return NextResponse.json({ success: true, updated: true });
  } catch (error) {
    console.error('[transactions/fee] could not attach the fee hash:', error);
    return NextResponse.json({ error: 'Could not record the fee reference' }, { status: 500 });
  }
}
