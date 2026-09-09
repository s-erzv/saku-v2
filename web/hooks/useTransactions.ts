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
  fromAddress: string | null;
  toAddress: string | null;
  /**
   * The Saku user on the other end, when there is one. An address is what the chain records,
   * but it is not what a person recognises — receipts lead with this and keep the addresses
   * below for the explorer link. Null when the counterparty is not a Saku user (a transfer out
   * to an external wallet, an off-ramp) or has never set a display name.
   */
  counterpartyName: string | null;
  /**
   * True when a Saku user is on the other end, whether or not they have set a display name.
   * A transfer out to an external wallet has no user behind it and is the only case where an
   * address is the honest answer.
   */
  counterpartyIsUser: boolean;
  /**
   * What the transfer was *for*, when "transfer" doesn't say it. Funding a packet, opening one,
   * and paying a split-bill share are all plain ERC20 transfers on-chain, so `type` calls all
   * three `transfer`; this is the intent behind them. Null on an ordinary send.
   */
  context: TransactionContext | null;
  /**
   * Platform fee, in base units, **added on top of** `amount` — never taken out of it. Null on
   * a transaction that carried no fee, and on every row written before fees were recorded.
   */
  feeAmount: string | null;
}

export type TransactionContext =
  | { kind: 'packet_send'; code?: string; slots?: number }
  | { kind: 'packet_claim'; code?: string }
  | { kind: 'split_bill'; title?: string };

export function useTransactions(limit = 10) {
  const { isAuthenticated } = useAuth();
  const [transactions, setTransactions] = useState<SakuTransaction[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!isAuthenticated) return;

    setIsLoading(true);
    try {
      const res = await fetch(`/api/transactions?limit=${limit}`, {
      });
      const data = await res.json();
      if (res.ok) setTransactions(data.transactions ?? []);
    } catch {
      // A history list that fails to load stays empty rather than breaking the home screen.
    } finally {
      setIsLoading(false);
    }
  }, [isAuthenticated, limit]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { transactions, isLoading, refresh };
}
