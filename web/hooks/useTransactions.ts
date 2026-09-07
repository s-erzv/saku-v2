'use client';

import { useCallback, useEffect, useState } from 'react';
import { useAuth } from './useAuth';

export interface SakuTransaction {
  txHash: string;
  type: 'transfer' | 'topup' | 'withdraw' | 'qr_payment' | 'offramp_lock' | 'offramp_settle' | 'offramp_refund';
  status: 'pending' | 'confirmed' | 'reverted';
  /** Base units, as a string — a uint256 does not survive a JSON number. */
  amount: string | null;
  tokenAddress: string | null;
  occurredAt: string;
  direction: 'in' | 'out';
}

export function useTransactions(limit = 10) {
  const { token } = useAuth();
  const [transactions, setTransactions] = useState<SakuTransaction[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!token) return;

    setIsLoading(true);
    try {
      const res = await fetch(`/api/transactions?limit=${limit}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (res.ok) setTransactions(data.transactions ?? []);
    } catch {
      // A history list that fails to load stays empty rather than breaking the home screen.
    } finally {
      setIsLoading(false);
    }
  }, [token, limit]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { transactions, isLoading, refresh };
}
