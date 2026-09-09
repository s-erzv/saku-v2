'use client';

/**
 * Split bills.
 *
 * Creating one moves no money — it records who owes what. Paying a share is an ordinary
 * transfer to the bill's creator, signed by the participant, then filed against the share.
 */

import { useCallback, useEffect, useState } from 'react';
import { Contract, formatUnits, parseUnits } from 'ethers';
import { useAuth } from './useAuth';
import { useMpcWallet } from './useMpcWallet';
import { CONTRACTS } from '@/lib/config';
import { chargePlatformFee, getTreasuryAddress } from '@/lib/platform-fee';
import { transferFee } from '@/lib/fees';
import type { BillCharges, BillItem, PersonTotal } from '@/lib/split-bill-math';

const USDC_DECIMALS = 6;
const ERC20_ABI = [
  'function transfer(address to, uint256 amount) returns (bool)',
  'function balanceOf(address owner) view returns (uint256)',
];

export interface BillSummary {
  id: string;
  title: string;
  totalAmount: string;
  status: string;
  createdAt: string;
}

export interface OwedShare {
  shareId: string;
  billId: string;
  title: string;
  amount: string;
  status: string;
  createdAt: string;
  /** Who created the bill, when they have a display name. */
  fromName: string | null;
}

/** Everything inside a breakdown is in the receipt's own currency — see `lib/split-bill-math.ts`. */
export interface BillBreakdown {
  currency: { code: string; symbol: string; decimals: number; locale: string; fxRate: number } | null;
  items: BillItem[];
  charges: BillCharges;
  participants: { id: string; label: string }[];
}

export interface ShareSummary {
  id: string;
  label: string;
  amount: string;
  status: string;
  isMe: boolean;
  breakdown: PersonTotal | null;
  /** Null on rows written before settling outside Saku existed — those were all on-chain. */
  paymentMethod: string | null;
  paymentNote: string | null;
}

export interface BillDetails {
  id: string;
  title: string;
  totalAmount: string;
  status: string;
  creatorAddress: string;
  isCreator: boolean;
  breakdown: BillBreakdown | null;
  myShare: { id: string; amount: string; status: string; breakdown: PersonTotal | null } | null;
  shares: ShareSummary[];
  paidCount: number;
}

export function useSplitBills() {
  const { token } = useAuth();
  const [created, setCreated] = useState<BillSummary[]>([]);
  const [owed, setOwed] = useState<OwedShare[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!token) return;
    setIsLoading(true);
    try {
      const res = await fetch('/api/split-bill', { headers: { Authorization: `Bearer ${token}` } });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not load bills');
      setCreated(data.created ?? []);
      setOwed(data.owed ?? []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load bills');
    } finally {
      setIsLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const createBill = useCallback(
    async (input: {
      title: string;
      totalAmount: number;
      participants: {
        /** A typed-in number, or a saved contact's hash — one of the two. */
        phone?: string;
        phoneHash?: string;
        label?: string;
        amount?: number;
        breakdown?: PersonTotal;
      }[];
      countryCode: string;
      /** The receipt behind the total. Optional: an evenly-split bill has no items to explain. */
      breakdown?: BillBreakdown;
    }) => {
      if (!token) return null;
      setError(null);
      try {
        const res = await fetch('/api/split-bill', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify(input),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Could not create the bill');
        await refresh();
        return data.billId as string;
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not create the bill');
        return null;
      }
    },
    [token, refresh]
  );

  return { created, owed, isLoading, error, refresh, createBill };
}

export function useBillDetails(id: string) {
  const { token } = useAuth();
  const { getSigner, address } = useMpcWallet();

  const [bill, setBill] = useState<BillDetails | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [paying, setPaying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    setIsLoading(true);
    try {
      const res = await fetch(`/api/split-bill/${id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Bill not found');
      setBill(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Bill not found');
    } finally {
      setIsLoading(false);
    }
  }, [id, token]);

  useEffect(() => {
    void load();
  }, [load]);

  const payShare = useCallback(async () => {
    if (!bill?.myShare) return null;
    setPaying(true);
    setError(null);

    try {
      const value = parseUnits(bill.myShare.amount, USDC_DECIMALS);
      // Added on top: the creator receives the full share, the fee is extra.
      const fee = parseUnits(
        transferFee(Number(bill.myShare.amount)).feeUsdc.toFixed(USDC_DECIMALS),
        USDC_DECIMALS
      );
      const signer = await getSigner();
      const usdc = new Contract(CONTRACTS.USDC, ERC20_ABI, signer);

      if (address) {
        const balance: bigint = await usdc.balanceOf(address);
        if (balance < value + fee) {
          throw new Error(
            `Not enough USDC: this share needs ${formatUnits(value + fee, USDC_DECIMALS)} including the fee, wallet holds ${formatUnits(balance, USDC_DECIMALS)}.`
          );
        }
      }

      const treasury = await getTreasuryAddress(token);

      const tx = await usdc.transfer(bill.creatorAddress, value);
      await tx.wait();

      const feeTxHash = await chargePlatformFee({
        signer, usdcAddress: CONTRACTS.USDC, treasury, feeUnits: fee,
      });

      const res = await fetch(`/api/split-bill/${id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ txHash: tx.hash, feeTxHash }),
      });
      const data = await res.json();
      // The transfer already happened on-chain; a bookkeeping failure is not a payment failure.
      if (!res.ok) console.warn('[split-bill] share not recorded:', data.error);

      await load();
      return tx.hash as string;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Payment failed';
      setError(/insufficient funds/i.test(message) ? 'Not enough tBNB for gas.' : message);
      return null;
    } finally {
      setPaying(false);
    }
  }, [address, bill, getSigner, id, load, token]);

  /**
   * Mark a share paid without moving anything through Saku — cash, another bank app.
   *
   * Deliberately separate from `payShare` rather than a flag on it: no signature, no transfer,
   * nothing to verify. It records a claim the bill's creator can see and argue with, which is
   * exactly what settling outside a payment app is.
   */
  const settleExternally = useCallback(
    async (note: string) => {
      if (!bill?.myShare) return false;
      setPaying(true);
      setError(null);
      try {
        const res = await fetch(`/api/split-bill/${id}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ method: 'external', note }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Could not mark this as paid');
        await load();
        return true;
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not mark this as paid');
        return false;
      } finally {
        setPaying(false);
      }
    },
    [bill, id, load, token]
  );

  return { bill, isLoading, paying, error, load, payShare, settleExternally };
}
