'use client';

import { useCallback, useEffect, useState } from 'react';
import { useAuth } from './useAuth';

export interface SakuTransaction {
  txHash: string;
  type:
    | 'transfer'
    | 'topup'
    | 'withdraw'
    | 'qr_payment'
    | 'offramp_lock'
    | 'offramp_settle'
    | 'offramp_refund'
    | 'stake'
    | 'unstake'
    | 'stake_reward';
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
  | { kind: 'split_bill'; title?: string }
  /**
   * The fiat leg of an off-ramp, for the receipt.
   *
   * An off-ramp receipt used to describe only the on-chain half — the USDC that left, its hash,
   * the network — which is the half the person cashing out cares least about. What they need to
   * show anyone is the other half: how much local currency arrived, where, and under whose
   * reference. None of that is on-chain, so none of it could be derived, and it is carried here.
   *
   * Client-side only. Nothing writes this to `transactions`; the off-ramp screen builds it from
   * the request it just polled.
   */
  | {
      kind: 'offramp_payout';
      /** Already formatted in the recipient's currency — the receipt does not convert. */
      fiatAmount?: string;
      /** "1 USDC = Rp 15,900", the rate the lock was struck at. */
      rate?: string;
      /** "GoPay", "Bank transfer" — the rail as the user picked it. */
      rail?: string;
      /** Masked. A receipt is a thing people photograph and send on. */
      destination?: string;
      /** Xendit's disbursement id, or the `MOCK-` reference when nothing moved. */
      payoutReference?: string;
      /** Who moved it. See `lib/offramp-payout.ts`. */
      provider?: string;
      /** True when no money actually moved. The receipt says so, in those words. */
      simulated?: boolean;
    };

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
