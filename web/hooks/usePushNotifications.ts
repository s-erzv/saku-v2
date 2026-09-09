'use client';

/**
 * The browser half of web push: permission, subscription, and telling the server about it.
 *
 * Permission is never requested on load. Browsers require a user gesture for it in practice, and
 * a permission prompt a user did not ask for is the fastest way to get permanently denied — so
 * `enable()` is only ever called from an explicit toggle (see
 * `components/profile/push-notifications.tsx`).
 */

import { useCallback, useEffect, useState } from 'react';
import { useAuth } from './useAuth';

export type PushStatus =
  | 'checking'
  /** No service worker or no Push API — iOS Safari outside an installed PWA lands here. */
  | 'unsupported'
  /** Supported, permission not yet asked for or asked and dismissed. */
  | 'idle'
  | 'enabled'
  /** The user said no. Only they can undo this, from browser settings. */
  | 'denied';

/** The applicationServerKey has to be raw bytes; the env var is base64url. */
function urlBase64ToBytes(base64: string): ArrayBuffer {
  const padded = (base64 + '='.repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(padded);
  const buffer = new ArrayBuffer(raw.length);
  const view = new Uint8Array(buffer);
  for (let i = 0; i < raw.length; i += 1) view[i] = raw.charCodeAt(i);
  return buffer;
}

const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? '';

export function usePushNotifications() {
  const { isAuthenticated } = useAuth();
  const [status, setStatus] = useState<PushStatus>('checking');
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const supported =
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window;

  useEffect(() => {
    let cancelled = false;

    async function check() {
      if (!supported || !VAPID_PUBLIC_KEY) {
        if (!cancelled) setStatus('unsupported');
        return;
      }
      if (Notification.permission === 'denied') {
        if (!cancelled) setStatus('denied');
        return;
      }

      // `ready` resolves only once a worker controls this page, so it doubles as "is the
      // registration from app/layout.tsx done yet".
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      if (!cancelled) setStatus(subscription ? 'enabled' : 'idle');
    }

    void check().catch(() => {
      if (!cancelled) setStatus('unsupported');
    });

    return () => {
      cancelled = true;
    };
  }, [supported]);

  const enable = useCallback(async () => {
    if (!supported || !isAuthenticated) return;

    setIsBusy(true);
    setError(null);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        setStatus(permission === 'denied' ? 'denied' : 'idle');
        return;
      }

      const registration = await navigator.serviceWorker.ready;
      const subscription =
        (await registration.pushManager.getSubscription()) ??
        (await registration.pushManager.subscribe({
          // Required by every browser now — a push service will not accept an unauthenticated
          // subscription.
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToBytes(VAPID_PUBLIC_KEY),
        }));

      const res = await fetch('/api/push/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(subscription.toJSON()),
      });

      if (!res.ok) {
        // A subscription the server did not keep would ring nowhere — drop it rather than leave
        // the toggle claiming it is on.
        await subscription.unsubscribe().catch(() => {});
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? 'Could not turn on notifications');
        setStatus('idle');
        return;
      }

      setStatus('enabled');
    } catch (err) {
      console.error('[push] enable failed:', err);
      setError('Could not turn on notifications');
    } finally {
      setIsBusy(false);
    }
  }, [supported, isAuthenticated]);

  const disable = useCallback(async () => {
    if (!supported || !isAuthenticated) return;

    setIsBusy(true);
    setError(null);
    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();

      await fetch('/api/push/unsubscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ endpoint: subscription?.endpoint ?? null }),
      });

      await subscription?.unsubscribe();
      setStatus('idle');
    } catch (err) {
      console.error('[push] disable failed:', err);
      setError('Could not turn off notifications');
    } finally {
      setIsBusy(false);
    }
  }, [supported, isAuthenticated]);

  return { status, isBusy, error, enable, disable };
}
