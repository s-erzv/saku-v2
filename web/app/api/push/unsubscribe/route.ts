/**
 * Drop one browser's push subscription.
 *
 * Scoped to the caller's own rows: an endpoint is a long unguessable URL, but "delete by
 * endpoint" without an owner check would still let anyone who learned one silence someone else.
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
    const body = await request.json().catch(() => ({}));
    const endpoint = typeof body?.endpoint === 'string' ? body.endpoint : null;

    const supabase = getSupabaseAdmin();
    const query = supabase.from('push_subscriptions').delete().eq('user_id', session.userId);

    // No endpoint means "this account, everywhere" — used when a user turns the toggle off from
    // a device whose own subscription has already been revoked by the browser.
    const { error } = endpoint ? await query.eq('endpoint', endpoint) : await query;

    if (error && error.code !== 'PGRST205' && error.code !== '42P01') throw error;

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[push/unsubscribe] failed:', error);
    return NextResponse.json({ error: 'Could not remove the subscription' }, { status: 500 });
  }
}
