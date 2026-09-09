/**
 * The caller's transaction history.
 *
 * Reads the `transactions` cache rather than scanning the chain: BSC has no cheap "all activity
 * for this address" query, and every row here was written from a verified receipt (see
 * `/api/transfer/record`), so the cache is derived from chain truth rather than from claims.
 *
 * Rows where the user is the counterparty are included too — money received is history.
 */

import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { getSession, unauthorized } from '@/lib/session';
import { CHAIN_ID } from '@/lib/chain';

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

interface DirectionRow {
  type: string;
  user_id: string | null;
  from_address: string | null;
  to_address: string | null;
}

/**
 * Does this row belong in the caller's history at all?
 *
 * A row reaches this user either as its owner or as its counterparty, and the second case is not
 * always a movement of *their* money. A packet claim names the packet's creator as counterparty
 * so they can see who opened it — but the tokens go from the treasury to the claimer, and the
 * creator's own balance was debited earlier, when they funded it. Listing the claim in their
 * history too showed them receiving 9.08 they never got, on top of the 50 they had already paid.
 *
 * Conservative on purpose: a row the caller owns is always kept, whatever its addresses say, and
 * a caller with no wallet on file keeps everything. Only a counterparty row that demonstrably
 * did not touch their wallet is dropped.
 */
function belongsToUser(row: DirectionRow, myAddress: string | null, userId: string): boolean {
  if (row.user_id === userId) return true;
  if (!myAddress) return true;
  return (
    row.to_address?.toLowerCase() === myAddress || row.from_address?.toLowerCase() === myAddress
  );
}

/**
 * Which way the money went, for this caller.
 *
 * The addresses are the truth and are checked first. The `user_id` fallback only covers rows
 * with no addresses recorded, and rows written before this user had a wallet on file.
 */
function directionFor(row: DirectionRow, myAddress: string | null, userId: string): 'in' | 'out' {
  if (myAddress) {
    if (row.to_address?.toLowerCase() === myAddress) return 'in';
    if (row.from_address?.toLowerCase() === myAddress) return 'out';
  }
  return row.user_id === userId && row.type !== 'topup' ? 'out' : 'in';
}

export async function GET(request: Request) {
  const session = await getSession(request);
  if (!session) return unauthorized();

  try {
    const url = new URL(request.url);
    const limit = Math.min(MAX_LIMIT, Math.max(1, Number(url.searchParams.get('limit')) || DEFAULT_LIMIT));

    const supabase = getSupabaseAdmin();

    // The caller's own address, so direction can be read off the transfer itself rather than
    // guessed from who owns the row. One extra row, once per request.
    const { data: myWallet } = await supabase
      .from('wallets')
      .select('address')
      .eq('user_id', session.userId)
      .eq('chain_id', CHAIN_ID)
      .maybeSingle();

    const myAddress = myWallet?.address?.toLowerCase() ?? null;

    const { data, error } = await supabase
      .from('transactions')
      .select('tx_hash, type, status, from_address, to_address, amount, token_address, occurred_at, user_id, counterparty_user_id, context, fee_amount')
      .or(`user_id.eq.${session.userId},counterparty_user_id.eq.${session.userId}`)
      .order('occurred_at', { ascending: false })
      .limit(limit);

    if (error) {
      // The table only exists after the schema migration runs. An empty history is a better
      // answer than a 500 on a screen whose whole job is to render a list.
      if (error.code === 'PGRST205' || error.code === '42P01') {
        return NextResponse.json({ transactions: [], pendingMigration: true });
      }
      throw error;
    }

    // One batched lookup for every counterparty on the page, not one per row. A history screen
    // that shows names should not cost a query per line.
    const counterpartyIds = [
      ...new Set(
        (data ?? [])
          .map((row) => (row.user_id === session.userId ? row.counterparty_user_id : row.user_id))
          .filter((id): id is string => Boolean(id) && id !== session.userId)
      ),
    ];

    const namesById = new Map<string, string>();
    if (counterpartyIds.length > 0) {
      const { data: counterparties } = await supabase
        .from('users')
        .select('id, display_name')
        .in('id', counterpartyIds);

      for (const user of counterparties ?? []) {
        if (user.display_name) namesById.set(user.id, user.display_name);
      }
    }

    const transactions = (data ?? [])
      .filter((row) => belongsToUser(row, myAddress, session.userId))
      .map((row) => ({
        txHash: row.tx_hash,
        type: row.type,
        status: row.status,
        // `amount` is a Postgres `numeric`; PostgREST hands it back as a JSON *number*, which is
        // exactly the lossy round-trip `SakuTransaction.amount: string` exists to avoid. Normalise
        // it here so every consumer really does get the string the type promises.
        amount: row.amount === null || row.amount === undefined ? null : String(row.amount),
        tokenAddress: row.token_address,
        occurredAt: row.occurred_at,
        context: row.context ?? null,
        // Always *additional to* `amount` — every fee in this app is added on top, so `amount`
        // is what the counterparty received and `amount + feeAmount` is what left the sender.
        feeAmount:
          row.fee_amount === null || row.fee_amount === undefined ? null : String(row.fee_amount),
        fromAddress: row.from_address,
        toAddress: row.to_address,
        // Whoever isn't the caller. A row reaches this user either as its owner (`user_id`) or as
        // its counterparty, so the other side flips depending on which one they are here.
        counterpartyName:
          namesById.get(row.user_id === session.userId ? (row.counterparty_user_id ?? '') : row.user_id) ?? null,
        // Whether the other end is a Saku user at all, which is a different question to whether
        // they have set a name. Someone who has not named themselves is still a person, and their
        // wallet address is not a way to refer to them.
        counterpartyIsUser: Boolean(
          row.user_id === session.userId ? row.counterparty_user_id : row.user_id
        ),
        // Direction from this user's point of view, so the UI does not have to know about
        // addresses to decide between a plus and a minus.
        //
        // Read off the transfer's own addresses, because "I own this row" is not the same claim as
        // "the money left me". A packet claim is filed with the claimer as `user_id` — they are
        // the one it happened to — but the tokens move *from* the treasury *to* them, and the old
        // rule turned every claim into a debit: you opened a packet and watched your history say
        // −9.08. The addresses are what actually moved, so they decide.
        direction: directionFor(row, myAddress, session.userId),
      }));

    return NextResponse.json({ transactions });
  } catch {
    return NextResponse.json({ error: 'Could not load history' }, { status: 500 });
  }
}
