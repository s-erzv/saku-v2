/**
 * Register a browser's push subscription against the logged-in user.
 *
 * The client never says who it is — the session token does. One person can have several rows
 * here (phone, laptop, a second browser); the endpoint is the unique key, so a browser that
 * re-subscribes updates its own row rather than adding another.
 */

import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { getSession, unauthorized } from '@/lib/session';

export async function POST(request: Request) {
  const session = await getSession(request);
  if (!session) return unauthorized();

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
      //
      // 42501 belongs here too, and it is the one that actually happened: the table existed but
      // `service_role` had no privileges on it, so every subscribe threw and the toggle reported
      // "Could not turn on notifications" — a message that sends you looking at VAPID keys and the
      // service worker rather than at a missing GRANT. A table nobody may write to is not set up.
      if (error.code === 'PGRST205' || error.code === '42P01' || error.code === '42501') {
        console.error('[push/subscribe] push_subscriptions unusable:', error.code, error.message);
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
