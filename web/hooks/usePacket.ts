'use client';

/**
 * Packets — creating one, and claiming from one.
 *
 * Creating is two steps in one call: the sender signs a real USDC transfer into the treasury,
 * then the server verifies that receipt and turns it into a packet. Funding first means a
 * packet row can never exist without money behind it.
 *
 * Claiming needs no signature from the claimer — the treasury pays out. That is the custodial
 * window this feature trades for being usable at all, and it is documented on the `packets`
 * table rather than left for someone to discover.
 */

import { useCallback, useState } from 'react';
import { Contract, parseUnits } from 'ethers';
import { useAuth } from './useAuth';
import { useMpcWallet } from './useMpcWallet';
import { CONTRACTS } from '@/lib/config';

const USDC_DECIMALS = 6;
const ERC20_ABI = [
  'function transfer(address to, uint256 amount) returns (bool)',
  'function balanceOf(address owner) view returns (uint256)',
];

export type PacketPhase = 'idle' | 'funding' | 'creating' | 'done' | 'failed';

export interface CreatedPacket {
  code: string;
  slots: number;
  totalAmount: string;
  expiresAt: string;
}

export interface PacketDetails {
  code: string;
  theme: string | null;
  message: string | null;
  splitMode: 'equal' | 'random';
  slots: number;
  claimedCount: number;
  totalAmount: string;
  remainingAmount: string;
  status: string;
  isCreator: boolean;
  alreadyClaimed: boolean;
  myAmount: string | null;
  claimable: boolean;
  invited: boolean;
}

export function useCreatePacket() {
  const { token } = useAuth();
  const { getSigner, address } = useMpcWallet();

  const [phase, setPhase] = useState<PacketPhase>('idle');
  const [error, setError] = useState<string | null>(null);
  const [packet, setPacket] = useState<CreatedPacket | null>(null);

  const reset = useCallback(() => {
    setPhase('idle');
    setError(null);
    setPacket(null);
  }, []);

  const create = useCallback(
    async (options: {
      amount: string;
      slots: number;
      splitMode: 'equal' | 'random';
      theme?: string;
      message?: string;
      restrictedTo?: string[];
      countryCode?: string;
    }) => {
      setError(null);

      try {
        const value = parseUnits(options.amount, USDC_DECIMALS);
        const signer = await getSigner();
        const usdc = new Contract(CONTRACTS.USDC, ERC20_ABI, signer);

        if (address) {
          const balance: bigint = await usdc.balanceOf(address);
          if (balance < value) throw new Error('Not enough USDC in your wallet.');
        }

        // The treasury address comes from the server, not from client config: it is where real
        // money is being sent, so it should not be something a stale bundle can get wrong.
        setPhase('funding');
        const infoRes = await fetch('/api/packet/treasury', {
          headers: { Authorization: `Bearer ${token}` },
        });
        const info = await infoRes.json();
        if (!infoRes.ok) throw new Error(info.error || 'Could not start the packet');

        const tx = await usdc.transfer(info.treasury, value);
        await tx.wait();

        setPhase('creating');
        const res = await fetch('/api/packet/create', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({
            txHash: tx.hash,
            slots: options.slots,
            splitMode: options.splitMode,
            theme: options.theme,
            message: options.message,
            restrictedTo: options.restrictedTo,
            countryCode: options.countryCode,
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Could not create the packet');

        setPacket({
          code: data.packet.code,
          slots: data.packet.slots,
          totalAmount: options.amount,
          expiresAt: data.packet.expires_at,
        });
        setPhase('done');
        return data.packet.code as string;
      } catch (err) {
        setPhase('failed');
        const message = err instanceof Error ? err.message : 'Could not create the packet';
        setError(/insufficient funds/i.test(message) ? 'Not enough tBNB for gas.' : message);
        return null;
      }
    },
    [address, getSigner, token]
  );

  return { phase, error, packet, create, reset };
}

export function useClaimPacket(code: string) {
  const { token } = useAuth();

  const [details, setDetails] = useState<PacketDetails | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [claiming, setClaiming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [claimed, setClaimed] = useState<{ amount: string; txHash?: string } | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    setIsLoading(true);
    try {
      const res = await fetch(`/api/packet/${code}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Packet not found');
      setDetails(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Packet not found');
    } finally {
      setIsLoading(false);
    }
  }, [code, token]);

  const claim = useCallback(async () => {
    if (!token) return;
    setClaiming(true);
    setError(null);
    try {
      const res = await fetch(`/api/packet/${code}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not claim');
      setClaimed({ amount: data.amount, txHash: data.payoutTxHash });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not claim');
    } finally {
      setClaiming(false);
    }
  }, [code, token, load]);

  return { details, isLoading, claiming, error, claimed, load, claim };
}
