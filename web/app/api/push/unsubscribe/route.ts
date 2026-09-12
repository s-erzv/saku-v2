/**
 * Drop one browser's push subscription.
 *
 * Scoped to the caller's own rows: an endpoint is a long unguessable URL, but "delete by
 * endpoint" without an owner check would still let anyone who learned one silence someone else.
 */

import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { getSession, unauthorized } from '@/lib/session';

export async function POST(request: Request) {
  const session = await getSession(request);
  if (!session) return unauthorized();

  try {
    const body = await request.json().catch(() => ({}));
    const endpoint = typeof body?.endpoint === 'string' ? body.endpoint : null;

    const supabase = getSupabaseAdmin();
    const query = supabase.from('push_subscriptions').delete().eq('user_id', session.userId);

    // No endpoint means "this account, everywhere" — used when a user turns the toggle off from
    // a device whose own subscription has already been revoked by the browser.
    const { error } = endpoint ? await query.eq('endpoint', endpoint) : await query;

    // A missing table, or one the server may not touch (42501), both mean there is no
    // subscription to remove — which is the outcome the caller asked for. Turning the toggle off
    // must not be the thing that fails.
    const absent = new Set(['PGRST205', '42P01', '42501']);
    if (error && !absent.has(error.code)) throw error;

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[push/unsubscribe] failed:', error);
    return NextResponse.json({ error: 'Could not remove the subscription' }, { status: 500 });
  }
}
