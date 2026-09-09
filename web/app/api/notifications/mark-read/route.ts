/**
 * Mark one notification, or every unread one, as read.
 *
 * Scoped to `session.userId` on every branch — the id in the body is never trusted alone, so a
 * caller can only ever mark their own notifications, never someone else's by guessing a UUID.
 */

import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { verifyToken, extractTokenFromHeader } from '@/lib/jwt';

export async function POST(request: Request) {
  const sessionToken = extractTokenFromHeader(request.headers.get('authorization'));
  if (!sessionToken) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let session;
  try {
    session = await verifyToken(sessionToken);
  } catch {
    return NextResponse.json({ error: 'Invalid or expired session' }, { status: 401 });
  }

  try {
    const body = await request.json().catch(() => ({}) as { id?: string });
    const supabase = getSupabaseAdmin();

    let query = supabase
      .from('notifications')
      .update({ is_read: true })
      .eq('user_id', session.userId);

    query = typeof body.id === 'string' ? query.eq('id', body.id) : query.eq('is_read', false);

    const { error } = await query;
    if (error) throw error;

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[notifications/mark-read] failed:', error);
    return NextResponse.json({ error: 'Could not update notifications' }, { status: 500 });
  }
}
