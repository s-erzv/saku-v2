/**
 * Register a browser's push subscription against the logged-in user.
 *
 * The client never says who it is — the session token does. One person can have several rows
 * here (phone, laptop, a second browser); the endpoint is the unique key, so a browser that
 * re-subscribes updates its own row rather than adding another.
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
    const body = await request.json();
    const endpoint = String(body?.endpoint ?? '');
    const p256dh = String(body?.keys?.p256dh ?? '');
    const auth = String(body?.keys?.auth ?? '');

    // A subscription missing either key cannot have a payload encrypted for it — storing it
    // would just produce a row that fails on every send.
    if (!endpoint.startsWith('https://') || !p256dh || !auth) {
      return NextResponse.json({ error: 'Invalid subscription' }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();
    const { error } = await supabase
      .from('push_subscriptions')
      .upsert(
        {
          user_id: session.userId,
          endpoint,
          p256dh,
          auth,
          user_agent: request.headers.get('user-agent')?.slice(0, 500) ?? null,
        },
        { onConflict: 'endpoint' }
      );

    if (error) {
      // The table only exists after the migration runs. Say so plainly rather than 500-ing on a
      // toggle whose whole job is to report whether it worked.
      if (error.code === 'PGRST205' || error.code === '42P01') {
        return NextResponse.json({ error: 'Push notifications are not set up yet' }, { status: 503 });
      }
      throw error;
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[push/subscribe] failed:', error);
    return NextResponse.json({ error: 'Could not save the subscription' }, { status: 500 });
  }
}
