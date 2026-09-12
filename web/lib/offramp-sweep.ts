/**
 * Sweeping off-ramp requests whose rate lock expired without settling.
 *
 * Before this, a refund had exactly one trigger: the user had to still be on the screen. The
 * client polls the status route, waits for `refundable: true` twice before believing it
 * (`hooks/useOfframp.ts` — a single read can be a clock edge), and only then offers the button
 * that calls `POST /api/offramp/[requestId]`. Close the app before that and the tokens stayed in
 * escrow. Recoverable, because `refund` is permissionless on-chain — but nobody was going to call
 * it, and "recoverable in principle" is not the same as "returned".
 *
 * `app/api/offramp/sweep/route.ts` is the caller that does, on a schedule. What belongs here is
 * the decision of *which* requests to touch and *what* to do with each, as plain functions over a
 * row, a chain status and a clock, so the part most likely to be wrong can be tested without a
 * chain or a database (`offramp-sweep.test.ts`).
 *
 * On not inventing a new row state: `offramp_requests.status` is a Postgres enum
 * (`offramp_status`), so a marker like `'refunding'` would need an `ALTER TYPE` before any code
 * could write it. It is not needed. The escrow is the lock: `refund` reverts with
 * `RequestNotLocked` once a request has moved on, so a double refund is impossible on-chain no
 * matter how many callers race. What the two guards below add is avoiding a pointless transaction
 * and keeping the database from recording the same refund twice.
 */

import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { CHAIN_ID } from '@/lib/chain';
import { getEscrowReadOnly } from '@/lib/escrow';

/**
 * How many requests one run will handle.
 *
 * A Netlify scheduled function is killed at 30 seconds, and each refund here is a transaction
 * plus a wait for its receipt — seconds, not milliseconds, on a public testnet RPC. Ten fits with
 * room to spare, and anything left over is picked up by the next run rather than by a run that
 * died halfway through its list.
 */
export const SWEEP_BATCH_SIZE = 10;

/**
 * How far past the rate lock a request has to be before the sweep touches it.
 *
 * The contract refuses a refund while `block.timestamp <= deadline`, and the block this
 * transaction lands in is always a little ahead of the clock that selected the row. Sweeping the
 * instant the deadline passes would therefore spend gas on transactions that revert. The client's
 * own check (`refundable` in the status route) has no such margin because a person reading a
 * screen retries; a cron job that reverts just reverts again in ten minutes.
 */
export const SWEEP_GRACE_MS = 15_000;

/** `Status` in `SakuOfframpEscrow`, which the ABI returns as a `uint8`. */
export const ESCROW_STATUS = {
  None: 0,
  Locked: 1,
  Settled: 2,
  Refunded: 3,
} as const;

/** The columns the sweep needs. A refund needs the amount and the owner to record history. */
export interface SweepableRow {
  id: string;
  request_id: string;
  status: string;
  rate_expires_at: string;
  amount: string;
  user_id: string;
}

export type SweepAction =
  | { action: 'refund' }
  /** The chain moved on without the database. Write down what actually happened. */
  | { action: 'reconcile'; status: 'settled' | 'refunded' }
  | { action: 'skip'; reason: string };

/**
 * The newest `rate_expires_at` worth selecting, as an ISO string for the query.
 *
 * Expressed as a cutoff rather than a filter applied in JavaScript so the grace period is part of
 * the `limit`ed query: without it a batch of ten could be filled entirely with requests that are
 * expired but not yet refundable, and the run would do nothing while older ones waited.
 */
export function sweepCutoff(nowMs: number): string {
  return new Date(nowMs - SWEEP_GRACE_MS).toISOString();
}

/** Whether a row read back from the database is one this sweep should act on at all. */
export function isSweepable(row: Pick<SweepableRow, 'status' | 'rate_expires_at'>, nowMs: number): boolean {
  if (row.status !== 'locked') return false;
  const expiresAt = new Date(row.rate_expires_at).getTime();
  if (!Number.isFinite(expiresAt)) return false;
  return nowMs - expiresAt > SWEEP_GRACE_MS;
}

/**
 * What to do with one request, given what the escrow says about it.
 *
 * The chain is asked before anything is sent, for two reasons. A request that settled or was
 * refunded while this row sat at `locked` needs the row corrected, not a refund attempted. And a
 * request the escrow has never heard of — a row written against a different deployment, say —
 * must not be guessed at.
 */
export function decideFromChain(status: number, deadlineMs: number, nowMs: number): SweepAction {
  if (status === ESCROW_STATUS.Refunded) return { action: 'reconcile', status: 'refunded' };
  if (status === ESCROW_STATUS.Settled) return { action: 'reconcile', status: 'settled' };
  if (status === ESCROW_STATUS.None) {
    return { action: 'skip', reason: 'the escrow has no record of this request' };
  }
  if (nowMs - deadlineMs <= SWEEP_GRACE_MS) {
    return { action: 'skip', reason: 'the rate lock has not expired far enough to refund yet' };
  }
  return { action: 'refund' };
}

/** What the escrow currently holds for a request. */
export async function readChainRequest(requestId: string): Promise<{ status: number; deadlineMs: number }> {
  const escrow = getEscrowReadOnly();
  const request = await escrow.getRequest(requestId);
  return {
    status: Number(request.status),
    deadlineMs: Number(request.deadline) * 1000,
  };
}

/**
 * Record a refund that has already happened on-chain.
 *
 * The update is conditional on the row still being `locked`, and that condition is the whole
 * point: the user's own refund and a sweep can reach the chain within the same second, and the
 * loser's `refund` call reverts — but both would otherwise write a history row, and the user
 * would see the same refund twice in Recent Activity. Only the caller whose update actually
 * matched a row writes the `transactions` entry. (`transactions.tx_hash` is not unique, so the
 * database will not catch this for us.)
 *
 * Returns whether this caller was the one that recorded it.
 */
export async function recordRefund(
  row: Pick<SweepableRow, 'id' | 'request_id' | 'amount' | 'user_id'>,
  receipt: { hash: string; blockNumber: number | null },
  source: 'auto' | 'manual'
): Promise<boolean> {
  const supabase = getSupabaseAdmin();

  const { data: claimed } = await supabase
    .from('offramp_requests')
    .update({
      status: 'refunded',
      refund_tx_hash: receipt.hash.toLowerCase(),
      fiat_status: 'not_started',
    })
    .eq('request_id', row.request_id.toLowerCase())
    .eq('status', 'locked')
    .select('id');

  if (!claimed || claimed.length === 0) return false;

  await supabase.from('transactions').insert({
    tx_hash: receipt.hash.toLowerCase(),
    chain_id: CHAIN_ID,
    type: 'offramp_refund',
    status: 'confirmed',
    amount: String(row.amount),
    user_id: row.user_id,
    block_number: receipt.blockNumber,
    offramp_request_id: row.id,
    // Which caller returned the money. The row is identical either way, and the difference
    // matters when reading back whether users are getting refunds because they waited on the
    // screen or because the sweep found them.
    context: { refund_source: source },
  });

  return true;
}

/**
 * Bring a row in line with a chain that moved on without it.
 *
 * Also conditional on `locked`, so this never overwrites a status someone else just wrote. No
 * `transactions` row: the refund or settlement this is catching up to was recorded by whoever
 * performed it, and inventing a history entry here with no transaction hash to point at would be
 * worse than the stale status it replaces.
 */
export async function reconcileStatus(requestId: string, status: 'settled' | 'refunded'): Promise<boolean> {
  const supabase = getSupabaseAdmin();

  const { data: updated } = await supabase
    .from('offramp_requests')
    .update({ status })
    .eq('request_id', requestId.toLowerCase())
    .eq('status', 'locked')
    .select('id');

  return (updated?.length ?? 0) > 0;
}
