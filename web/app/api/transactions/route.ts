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
import { verifyToken, extractTokenFromHeader } from '@/lib/jwt';

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

export async function GET(request: Request) {
  const sessionToken = extractTokenFromHeader(request.headers.get('authorization'));
  if (!sessionToken) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let session;
  try {
    session = await verifyToken(sessionToken);
  } catch {
    return NextResponse.json({ error: 'Invalid or expired session' }, { status: 401 });
  }

  try {
    const url = new URL(request.url);
    const limit = Math.min(MAX_LIMIT, Math.max(1, Number(url.searchParams.get('limit')) || DEFAULT_LIMIT));

    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from('transactions')
      .select('tx_hash, type, status, from_address, to_address, amount, token_address, occurred_at, user_id, counterparty_user_id')
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

    const transactions = (data ?? []).map((row) => ({
      txHash: row.tx_hash,
      type: row.type,
      status: row.status,
      amount: row.amount,
      tokenAddress: row.token_address,
      occurredAt: row.occurred_at,
      // Direction from this user's point of view, so the UI does not have to know about
      // addresses to decide between a plus and a minus.
      direction: row.user_id === session.userId && row.type !== 'topup' ? 'out' : 'in',
    }));

    return NextResponse.json({ transactions });
  } catch {
    return NextResponse.json({ error: 'Could not load history' }, { status: 500 });
  }
}
