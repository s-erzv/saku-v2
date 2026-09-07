'use client';

/**
 * Split bills.
 *
 * Creating one moves no money — it records who owes what. Paying a share is an ordinary
 * transfer to the bill's creator, signed by the participant, then filed against the share.
 */

import { useCallback, useEffect, useState } from 'react';
import { Contract, parseUnits } from 'ethers';
import { useAuth } from './useAuth';
import { useMpcWallet } from './useMpcWallet';
import { CONTRACTS } from '@/lib/config';

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
}

export interface BillDetails {
  id: string;
  title: string;
  totalAmount: string;
  status: string;
  creatorAddress: string;
  isCreator: boolean;
  myShare: { id: string; amount: string; status: string } | null;
  shares: { id: string; label: string; amount: string; status: string; isMe: boolean }[];
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
      participants: { phone: string; label?: string; amount?: number }[];
      countryCode: string;
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
      const signer = await getSigner();
      const usdc = new Contract(CONTRACTS.USDC, ERC20_ABI, signer);

      if (address) {
        const balance: bigint = await usdc.balanceOf(address);
        if (balance < value) throw new Error('Not enough USDC in your wallet.');
      }

      const tx = await usdc.transfer(bill.creatorAddress, value);
      await tx.wait();

      const res = await fetch(`/api/split-bill/${id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ txHash: tx.hash }),
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

  return { bill, isLoading, paying, error, load, payShare };
}
