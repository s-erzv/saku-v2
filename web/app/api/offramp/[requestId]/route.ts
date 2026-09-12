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
import { isSimulatedPayout, payoutProvider } from '@/lib/offramp-payout';
import { refundOfframp } from '@/lib/escrow';
import { decideFromChain, readChainRequest, reconcileStatus, recordRefund } from '@/lib/offramp-sweep';

/**
 * The columns this route reads back.
 *
 * Typed explicitly because supabase-js infers a select passed as a variable as possibly an
 * error shape, which makes every field access below a type error.
 */
interface OfframpRow {
  id: string;
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
  // `id` is here so a refund's history row can point back at this request. It was missing, and
  // `transactions.offramp_request_id` was empty for every refund as a result.
  'id, request_id, status, fiat_status, amount, recipient_rail, rate_expires_at, ' +
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
      // describes the payout. Collapsing them is how a demo starts implying it moved rupiah.
      //
      // `fiatSimulated` was hardcoded `true`, which stopped being honest the moment real Xendit
      // disbursements started going out for Indonesian e-wallets: a genuine payout was being
      // reported to its own recipient as a simulation. It is read off the reference now — see
      // `lib/offramp-payout.ts` for why the reference is what decides it.
      onChainReal: true,
      fiatSimulated: isSimulatedPayout(row.mock_disbursement_reference),
      payoutReference: row.mock_disbursement_reference,
      payoutProvider: payoutProvider(row.mock_disbursement_reference),
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

    // Ask the escrow before spending gas on a transaction that may be certain to revert. The
    // scheduled sweep (`/api/offramp/sweep`) can reach the same request first, and `refund` on a
    // request the escrow has already moved on from reverts — a correct outcome, but one that would
    // surface here as a 500 carrying a contract error string. The decision is shared with the sweep
    // (`lib/offramp-sweep.ts`) precisely so the two callers cannot disagree about what is eligible.
    const chain = await readChainRequest(requestId.toLowerCase());
    const decision = decideFromChain(chain.status, chain.deadlineMs, Date.now());

    if (decision.action === 'reconcile') {
      await reconcileStatus(requestId.toLowerCase(), decision.status);
      return NextResponse.json(
        {
          error: `Nothing to refund — the escrow reports this as ${decision.status}`,
          status: decision.status,
        },
        { status: 409 }
      );
    }

    if (decision.action === 'skip') {
      return NextResponse.json(
        { error: decision.reason, refundableAfter: row.rate_expires_at },
        { status: 409 }
      );
    }

    const receipt = await refundOfframp(requestId.toLowerCase());

    // `user_id` is not in this route's `SELECT`, but `loadOwned` already filtered the row to this
    // session, so the owner is the caller. `recorded` is false when the sweep claimed the row in
    // the same moment and wrote the history entry — the money is back either way, and a second
    // entry would show the user one refund twice.
    const recorded = await recordRefund({ ...row, user_id: session.userId }, receipt, 'manual');

    return NextResponse.json({ success: true, status: 'refunded', refundTxHash: receipt.hash, recorded });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Refund failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
