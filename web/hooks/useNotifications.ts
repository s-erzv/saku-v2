'use client';

import { useCallback, useEffect, useState } from 'react';
import { useAuth } from './useAuth';

export interface SakuNotification {
  id: string;
  type: string;
  message: string;
  metadata: Record<string, unknown> | null;
  is_read: boolean;
  created_at: string;
}

export function useNotifications(limit = 30) {
  const { token } = useAuth();
  const [notifications, setNotifications] = useState<SakuNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [isLoading, setIsLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!token) return;

    setIsLoading(true);
    try {
      const res = await fetch(`/api/notifications?limit=${limit}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (res.ok) {
        setNotifications(data.notifications ?? []);
        setUnreadCount(data.unreadCount ?? 0);
      }
    } catch {
      // A notification list that fails to load stays empty rather than breaking the page.
    } finally {
      setIsLoading(false);
    }
  }, [token, limit]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  /** Optimistic: flips locally first so the badge and the row update immediately, then confirms. */
  const markAsRead = useCallback(
    async (id?: string) => {
      if (!token) return;

      setNotifications((prev) =>
        prev.map((n) => (!id || n.id === id ? { ...n, is_read: true } : n))
      );
      setUnreadCount((prev) => (id ? Math.max(0, prev - 1) : 0));

      try {
        await fetch('/api/notifications/mark-read', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify(id ? { id } : {}),
        });
      } catch {
        // The next refresh() reconciles if this silently failed — not worth surfacing an error
        // for a read-receipt.
      }
    },
    [token]
  );

  return { notifications, unreadCount, isLoading, refresh, markAsRead };
}
