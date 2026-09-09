/**
 * Writing a verified transaction into the history cache.
 *
 * Every caller of this has already moved money on-chain by the time it runs. That ordering is
 * not negotiable — the row is written *from* a verified receipt, so it cannot be written before
 * one exists — but it does mean a failed insert loses the record of something that really
 * happened, and the user has no way to get it back.
 *
 * So a missing column degrades rather than throws. `fee_amount` and `fee_tx_hash` arrived on
 * 2026-09-09; a deployment whose database has not caught up should record the transfer without
 * the fee, not lose the transfer.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

/** PostgREST reports an unknown column as PGRST204; Postgres itself as 42703. */
const UNKNOWN_COLUMN = ['PGRST204', '42703'];
/** A duplicate is success: the row this wanted is already there. */
const DUPLICATE = '23505';

const FEE_COLUMNS = ['fee_amount', 'fee_tx_hash'] as const;

export interface RecordResult {
  /** True when the row is in the table — including when a duplicate meant it already was. */
  recorded: boolean;
  /**
   * True when this exact transaction was already recorded. Callers use it to avoid acting twice
   * on a resubmitted request — notifying a recipient a second time, for instance.
   */
  duplicate: boolean;
  /** True when the fee had to be dropped because the schema has not been migrated yet. */
  degraded: boolean;
}

export async function recordTransaction(
  supabase: SupabaseClient,
  row: Record<string, unknown>
): Promise<RecordResult> {
  const { error } = await supabase.from('transactions').insert(row);

  if (!error) return { recorded: true, duplicate: false, degraded: false };
  if (error.code === DUPLICATE) return { recorded: true, duplicate: true, degraded: false };

  if (UNKNOWN_COLUMN.includes(error.code ?? '') && FEE_COLUMNS.some((column) => column in row)) {
    console.warn('[transactions] fee columns not migrated yet; recording without the fee');

    const withoutFee = { ...row };
    for (const column of FEE_COLUMNS) delete withoutFee[column];

    const retry = await supabase.from('transactions').insert(withoutFee);
    if (!retry.error) return { recorded: true, duplicate: false, degraded: true };
    if (retry.error.code === DUPLICATE) return { recorded: true, duplicate: true, degraded: true };
    throw retry.error;
  }

  throw error;
}
