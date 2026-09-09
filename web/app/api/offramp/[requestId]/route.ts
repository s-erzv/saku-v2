/**
 * One off-ramp request: what happened to it, and the way out when settlement did not happen.
 *
 * GET reports status. POST attempts the refund, which only the contract can authorise — it
 * reverts with `RateNotYetExpired` until the deadline passes (PRD Section 5.3). Refund is
 * permissionless on-chain, so this route exists to spare the user from having to know that
 * they need to call it, not to grant permission they lack.
 */

import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { getSession, unauthorized } from '@/lib/session';
import { CHAIN_ID } from '@/lib/chain';
import { refundOfframp } from '@/lib/escrow';

/**
 * The columns this route reads back.
 *
 * Typed explicitly because supabase-js infers a select passed as a variable as possibly an
 * error shape, which makes every field access below a type error.
 */
interface OfframpRow {
  request_id: string;
  status: string;
  fiat_status: string;
  amount: string;
  recipient_rail: string;
  rate_expires_at: string;
  lock_tx_hash: string | null;
  settle_tx_hash: string | null;
  refund_tx_hash: string | null;
  stable_amount_out: string | null;
  fiat_amount_idr: string | null;
  mock_exchange_reference: string | null;
  mock_disbursement_reference: string | null;
  failure_reason: string | null;
  created_at: string;
}

const SELECT =
  'request_id, status, fiat_status, amount, recipient_rail, rate_expires_at, ' +
  'lock_tx_hash, settle_tx_hash, refund_tx_hash, stable_amount_out, ' +
  'fiat_amount_idr, mock_exchange_reference, mock_disbursement_reference, failure_reason, created_at';

async function loadOwned(userId: string, requestId: string): Promise<OfframpRow | null> {
  const supabase = getSupabaseAdmin();
  // Scoped to the caller: a request id is on-chain and therefore public, so ownership has to be
  // checked here rather than assumed from knowing the id.
  const { data } = await supabase
    .from('offramp_requests')
    .select(SELECT)
    .eq('request_id', requestId.toLowerCase())
    .eq('user_id', userId)
    .maybeSingle();

  return (data as OfframpRow | null) ?? null;
}

const requireSession = getSession;

export async function GET(request: Request, { params }: { params: Promise<{ requestId: string }> }) {
  const session = await requireSession(request);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { requestId } = await params;

  try {
    const row = await loadOwned(session.userId, requestId);
    if (!row) return NextResponse.json({ error: 'Request not found' }, { status: 404 });

    return NextResponse.json({
      ...row,
      // The distinction the PRD insists on: `status` describes what the chain did, `fiat_status`
      // describes a simulation. Collapsing them is how a demo starts implying it moved rupiah.
      onChainReal: true,
      fiatSimulated: true,
      refundable:
        row.status === 'locked' && new Date(row.rate_expires_at).getTime() < Date.now(),
    });
  } catch {
    return NextResponse.json({ error: 'Could not load this request' }, { status: 500 });
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ requestId: string }> }) {
  const session = await requireSession(request);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { requestId } = await params;

  try {
    const row = await loadOwned(session.userId, requestId);
    if (!row) return NextResponse.json({ error: 'Request not found' }, { status: 404 });

    if (row.status !== 'locked') {
      return NextResponse.json({ error: `Nothing to refund — request is ${row.status}` }, { status: 400 });
    }
    if (new Date(row.rate_expires_at).getTime() >= Date.now()) {
      return NextResponse.json(
        { error: 'The rate lock has not expired yet', refundableAfter: row.rate_expires_at },
        { status: 409 }
      );
    }

    const receipt = await refundOfframp(requestId.toLowerCase());
    const supabase = getSupabaseAdmin();

    await supabase
      .from('offramp_requests')
      .update({
        status: 'refunded',
        refund_tx_hash: receipt.hash.toLowerCase(),
        fiat_status: 'not_started',
      })
      .eq('request_id', requestId.toLowerCase());

    await supabase.from('transactions').insert({
      tx_hash: receipt.hash.toLowerCase(),
      chain_id: CHAIN_ID,
      type: 'offramp_refund',
      status: 'confirmed',
      amount: String(row.amount),
      user_id: session.userId,
      block_number: receipt.blockNumber,
    });

    return NextResponse.json({ success: true, status: 'refunded', refundTxHash: receipt.hash });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Refund failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
