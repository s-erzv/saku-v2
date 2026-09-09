/**
 * List the caller's notifications.
 *
 * Every write side of this already existed before this route did — `transfer/record`,
 * `offramp/lock`, `split-bill`, `packet`, `qr-payment`, and `topup` have all been inserting into
 * `notifications` since the v2 rewrite. This is the missing read side: without it, those rows
 * accumulated with nothing ever surfacing them to a user.
 *
 * `message` is composed here rather than returned as stored — see `lib/notification-copy.ts` for
 * why the sentence is built at read time. The stored string stays the fallback.
 */

import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { verifyToken, extractTokenFromHeader } from '@/lib/jwt';
import { counterpartyIdOf, formatNotification } from '@/lib/notification-copy';

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
    const limit = Math.min(Math.max(Number(url.searchParams.get('limit') ?? '30'), 1), 100);

    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from('notifications')
      .select('id, type, message, metadata, is_read, created_at')
      .eq('user_id', session.userId)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) throw error;

    const rows = data ?? [];

    // One lookup for every name this page of notifications needs, not one per row.
    const counterpartyIds = [
      ...new Set(rows.map((row) => counterpartyIdOf(row.metadata)).filter((id): id is string => Boolean(id))),
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

    const notifications = rows.map((row) => ({
      ...row,
      message: formatNotification(row, (id) => (id ? (namesById.get(id) ?? null) : null)),
    }));

    const { count: unreadCount } = await supabase
      .from('notifications')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', session.userId)
      .eq('is_read', false);

    return NextResponse.json({ notifications, unreadCount: unreadCount ?? 0 });
  } catch (error) {
    console.error('[notifications] failed:', error);
    return NextResponse.json({ error: 'Could not load notifications' }, { status: 500 });
  }
}
