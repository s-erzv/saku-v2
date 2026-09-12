/**
 * Return the money on expired off-ramp locks, without waiting for the user to come back.
 *
 * `refund` is permissionless on the escrow, and until now that was doing no work: the only caller
 * was the user's own screen (`POST /api/offramp/[requestId]`, reached from `hooks/useOfframp.ts`
 * after it sees `refundable` twice). Anyone who closed the app during a failed settlement left
 * their tokens sitting in escrow until they happened to open Saku again. This route is the caller
 * that does not need them to be watching.
 *
 * **Not reachable from a browser.** It is authenticated by a shared secret in
 * `OFFRAMP_SWEEP_TOKEN`, the same shape as the Xendit webhook's `x-callback-token`
 * (`lib/xendit.ts`) — there is no session here to check, because the whole point is that nobody
 * is signed in. With the variable unset the route refuses every request rather than running
 * unauthenticated: a sweep that anyone on the internet can trigger is a free way to make Saku
 * spend settler gas.
 *
 * The schedule lives in `netlify/functions/offramp-sweep.mts`. Keeping the work here rather than
 * in that function is deliberate: it runs with the app's own env, imports, and database client, it
 * can be exercised with `curl` in development, and moving off Netlify means rewriting a four-line
 * wrapper instead of this file.
 *
 * What it does not do: retry a failed refund inside one run, or hold a lock across runs. A failure
 * is written to `failure_reason` and the request is simply still expired on the next pass.
 */

import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';

import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { refundOfframp } from '@/lib/escrow';
import { logAuthEvent } from '@/lib/audit-log';
import {
  decideFromChain,
  isSweepable,
  readChainRequest,
  recordRefund,
  reconcileStatus,
  SWEEP_BATCH_SIZE,
  sweepCutoff,
  type SweepableRow,
} from '@/lib/offramp-sweep';

const SELECT = 'id, request_id, status, rate_expires_at, amount, user_id';

/** Constant-time comparison against the configured secret, or false when there isn't one. */
function authorized(received: string | null): boolean {
  const expected = process.env.OFFRAMP_SWEEP_TOKEN?.trim();
  if (!expected || !received) return false;

  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(received, 'utf8');
  if (a.length !== b.length) return false;

  return timingSafeEqual(a, b);
}

interface SweepOutcome {
  requestId: string;
  result: 'refunded' | 'reconciled' | 'skipped' | 'failed';
  detail?: string;
}

export async function POST(request: Request) {
  if (!authorized(request.headers.get('x-sweep-token'))) {
    // Deliberately the same answer whether the secret is wrong or absent.
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const now = Date.now();
  const supabase = getSupabaseAdmin();

  const { data, error } = await supabase
    .from('offramp_requests')
    .select(SELECT)
    .eq('status', 'locked')
    .lt('rate_expires_at', sweepCutoff(now))
    // Oldest first: a request that has been stuck longest is the one whose owner has been waiting
    // longest, and it keeps a permanent backlog from starving behind fresher rows.
    .order('rate_expires_at', { ascending: true })
    .limit(SWEEP_BATCH_SIZE);

  if (error) {
    console.error('[offramp/sweep] could not list expired locks:', error);
    return NextResponse.json({ error: 'Could not list expired locks' }, { status: 500 });
  }

  const rows = (data ?? []) as SweepableRow[];
  const outcomes: SweepOutcome[] = [];

  // Sequential on purpose. Every refund is sent by the one settler wallet, and transactions from a
  // single account have to be mined in nonce order — firing ten at once leaves the later ones
  // queued behind each other anyway, and a gap in that sequence stalls the rest.
  for (const row of rows) {
    const requestId = row.request_id.toLowerCase();

    try {
      // The query already filtered on this; checking again costs nothing and means the rule lives
      // in one tested place rather than in a query string.
      if (!isSweepable(row, now)) {
        outcomes.push({ requestId, result: 'skipped', detail: 'no longer eligible when reached' });
        continue;
      }

      const chain = await readChainRequest(requestId);
      const decision = decideFromChain(chain.status, chain.deadlineMs, now);

      if (decision.action === 'skip') {
        outcomes.push({ requestId, result: 'skipped', detail: decision.reason });
        continue;
      }

      if (decision.action === 'reconcile') {
        const changed = await reconcileStatus(requestId, decision.status);
        outcomes.push({
          requestId,
          result: changed ? 'reconciled' : 'skipped',
          detail: changed ? `chain says ${decision.status}` : 'another writer got there first',
        });
        continue;
      }

      const receipt = await refundOfframp(requestId);
      const recorded = await recordRefund(row, receipt, 'auto');

      if (!recorded) {
        // The user's own refund landed in the same moment and wrote the history row. The money is
        // back either way, which is the part that matters.
        outcomes.push({ requestId, result: 'skipped', detail: 'recorded by another caller' });
        continue;
      }

      await logAuthEvent(request, {
        type: 'auto_refund_triggered',
        userId: row.user_id,
        metadata: {
          request_id: requestId,
          refund_tx: receipt.hash.toLowerCase(),
          amount: String(row.amount),
          // How long the funds sat past their lock before anything returned them. The number this
          // feature exists to keep small.
          stuck_ms: now - new Date(row.rate_expires_at).getTime(),
        },
      });

      outcomes.push({ requestId, result: 'refunded', detail: receipt.hash.toLowerCase() });
    } catch (err) {
      const reason = err instanceof Error ? err.message : 'Refund failed';
      console.error(`[offramp/sweep] ${requestId} failed:`, reason);

      // Same column the synchronous settle path writes, so one place tells the story of a request
      // that could not be finished. The row stays `locked`, so the next run tries again.
      await supabase
        .from('offramp_requests')
        .update({ failure_reason: reason.slice(0, 500) })
        .eq('request_id', requestId);

      outcomes.push({ requestId, result: 'failed', detail: reason.slice(0, 200) });
    }
  }

  const counted = (result: SweepOutcome['result']) => outcomes.filter((o) => o.result === result).length;

  return NextResponse.json({
    scanned: rows.length,
    refunded: counted('refunded'),
    reconciled: counted('reconciled'),
    skipped: counted('skipped'),
    failed: counted('failed'),
    // Worth returning rather than only logging: this is what the Netlify function's run log shows,
    // and it is the only view of a sweep anyone gets without database access.
    outcomes,
  });
}
