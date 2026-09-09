/**
 * Web Push — the out-of-app half of the notification centre.
 *
 * Every call here is best-effort and swallowed. A push is a courtesy copy of a row that has
 * already been written to `notifications`; failing a transfer, a claim, or a settlement because
 * a browser's push service was slow would trade real money movement for a convenience.
 *
 * Not every notification pushes. The in-app centre logs everything, but an OS-level notification
 * costs the user attention, so only the events they would want to be interrupted for are sent —
 * see `PUSHABLE`. Called today from `/api/transfer/record`, `/api/qr-payment/[code]`,
 * `/api/split-bill/[id]` and `/api/offramp/lock`; widening the set means adding a type to
 * `PUSHABLE` and a call at the corresponding insert site (`/api/packet/[code]`,
 * `/api/split-bill`, `lib/topup.ts` are the three that write rows but do not push).
 */

import webpush from 'web-push';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { formatNotification } from '@/lib/notification-copy';

/**
 * Money arriving, and an off-ramp reaching the other side, are the two things worth a buzz.
 * `system` (added to a split bill, top up completed while the user is watching the screen that
 * completed it) and `transfer_sent` (an echo of something the user just did themselves) are
 * logged in-app only.
 */
const PUSHABLE = new Set(['transfer_received', 'offramp_status']);

let configured: boolean | null = null;

/** Returns false — rather than throwing — when VAPID isn't configured, so dev without keys works. */
function ensureConfigured(): boolean {
  if (configured !== null) return configured;

  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT ?? 'mailto:hello@saku.app';

  if (!publicKey || !privateKey) {
    configured = false;
    return false;
  }

  webpush.setVapidDetails(subject, publicKey, privateKey);
  configured = true;
  return true;
}

export interface PushableNotification {
  userId: string;
  type: string;
  /** The stored fallback string, used when `metadata` can't produce a better sentence. */
  message: string;
  metadata: Record<string, unknown> | null;
}

/**
 * Send one notification to every device the user has subscribed.
 *
 * The body is composed with the same formatter the notification list uses, so the banner and the
 * row it corresponds to say the same thing.
 */
export async function sendPushNotification(notification: PushableNotification): Promise<void> {
  if (!PUSHABLE.has(notification.type)) return;
  if (!ensureConfigured()) return;

  try {
    const supabase = getSupabaseAdmin();

    const { data: subscriptions } = await supabase
      .from('push_subscriptions')
      .select('id, endpoint, p256dh, auth')
      .eq('user_id', notification.userId);

    if (!subscriptions || subscriptions.length === 0) return;

    // The counterparty's name, resolved once for all of this user's devices.
    const counterpartyId =
      typeof notification.metadata?.counterparty_user_id === 'string'
        ? notification.metadata.counterparty_user_id
        : null;

    let counterpartyName: string | null = null;
    if (counterpartyId) {
      const { data: counterparty } = await supabase
        .from('users')
        .select('display_name')
        .eq('id', counterpartyId)
        .maybeSingle();
      counterpartyName = counterparty?.display_name ?? null;
    }

    const body = formatNotification(notification, () => counterpartyName);
    const payload = JSON.stringify({
      title: 'Saku',
      body,
      // Where `notificationclick` sends them. The centre, not a deep link: a push can arrive long
      // after the event, and a stale transaction screen is a worse landing than the list.
      url: '/notifications',
      tag: notification.type,
    });

    const results = await Promise.allSettled(
      subscriptions.map((sub) =>
        webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          payload
        )
      )
    );

    // 404/410 is the push service saying this subscription is permanently gone — the browser was
    // uninstalled, or permission was revoked. Keeping it means retrying a dead endpoint forever.
    const dead = results
      .map((result, index) => {
        if (result.status !== 'rejected') return null;
        const status = (result.reason as { statusCode?: number })?.statusCode;
        return status === 404 || status === 410 ? subscriptions[index].id : null;
      })
      .filter((id): id is string => Boolean(id));

    if (dead.length > 0) {
      await supabase.from('push_subscriptions').delete().in('id', dead);
    }
  } catch (error) {
    // Never propagates: see the module comment.
    console.error('[push] send failed:', error);
  }
}
