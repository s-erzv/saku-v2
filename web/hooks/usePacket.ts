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

import { useCallback, useEffect, useState } from 'react';
import { Contract, formatUnits, parseUnits } from 'ethers';
import { useAuth } from './useAuth';
import { useMpcWallet } from './useMpcWallet';
import { CONTRACTS } from '@/lib/config';
import { chargePlatformFee, getTreasuryAddress } from '@/lib/platform-fee';
import { transferFee } from '@/lib/fees';

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
  expiresAt: string | null;
}

export interface PacketDetails {
  code: string;
  theme: string | null;
  message: string | null;
  /** The packet creator's display name, for signing their note. */
  fromName: string | null;
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

  /**
   * Drop a failure the user has since edited away.
   *
   * Without this the message from a rejected attempt stays on screen while the form is changed
   * underneath it, so a packet that is now perfectly fundable still reads "Not enough USDC in
   * your wallet" — an error about numbers that are no longer on the screen.
   */
  const clearError = useCallback(() => setError(null), []);

  const create = useCallback(
    async (options: {
      amount: string;
      slots: number;
      splitMode: 'equal' | 'random';
      theme?: string;
      message?: string;
      /** Hours until it expires, or `null` for never. Omitted uses the server default. */
      expiresInHours?: number | null;
      /** Private circle: phone hashes from the address book. */
      restrictedToHashes?: string[];
      restrictedTo?: string[];
      countryCode?: string;
    }) => {
      setError(null);

      try {
        const value = parseUnits(options.amount, USDC_DECIMALS);
        // Added on top: the packet is funded with the full amount, the fee is extra.
        const fee = parseUnits(
          transferFee(Number(options.amount)).feeUsdc.toFixed(USDC_DECIMALS),
          USDC_DECIMALS
        );
        const signer = await getSigner();
        const usdc = new Contract(CONTRACTS.USDC, ERC20_ABI, signer);

        if (address) {
          const balance: bigint = await usdc.balanceOf(address);
          if (balance < value + fee) {
            // Both figures, because "not enough" on its own is unfalsifiable when the balance
            // shown at the top of the same screen says otherwise.
            throw new Error(
              `Not enough USDC: this packet needs ${formatUnits(value + fee, USDC_DECIMALS)} including the fee, wallet holds ${formatUnits(balance, USDC_DECIMALS)}.`
            );
          }
        }

        // The treasury address comes from the server, not from client config: it is where real
        // money is being sent, so it should not be something a stale bundle can get wrong.
        setPhase('funding');
        const infoRes = await fetch('/api/treasury', {
          headers: { Authorization: `Bearer ${token}` },
        });
        const info = await infoRes.json();
        if (!infoRes.ok) throw new Error(info.error || 'Could not start the packet');

        const tx = await usdc.transfer(info.treasury, value);
        await tx.wait();

        // The fee is a separate transfer even though the packet's own funding already goes to
        // the treasury: one is the packet's money, held until claimed, the other is Saku's. A
        // single combined transfer would make the packet look overfunded by the fee.
        const feeTxHash = await chargePlatformFee({
          signer, usdcAddress: CONTRACTS.USDC, treasury: info.treasury, feeUnits: fee,
        });

        setPhase('creating');
        const res = await fetch('/api/packet/create', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({
            txHash: tx.hash,
            feeTxHash,
            slots: options.slots,
            splitMode: options.splitMode,
            theme: options.theme,
            message: options.message,
            expiresInHours: options.expiresInHours,
            restrictedToHashes: options.restrictedToHashes,
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

  return { phase, error, packet, create, reset, clearError };
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
    if (!token) return null;
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
      // Returned, not just stored: the screen has to know whether to play the opening at all.
      // It used to open and fire confetti on a failed claim, because this resolved the same way
      // either way.
      return { amount: data.amount as string, txHash: data.payoutTxHash as string | undefined };
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not claim');
      return null;
    } finally {
      setClaiming(false);
    }
  }, [code, token, load]);

  return { details, isLoading, claiming, error, claimed, load, claim };
}

export interface InvitedPacket {
  code: string;
  theme: string | null;
  message: string | null;
  fromName: string | null;
  totalAmount: string;
  remainingAmount: string;
  slots: number;
  claimedCount: number;
  expiresAt: string | null;
}

export interface PacketClaimer {
  /** Null when they never set a display name — never an address or a number. */
  name: string | null;
  amount: string;
  claimedAt: string;
}

export interface MyPacket {
  code: string;
  theme: string | null;
  message: string | null;
  totalAmount: string;
  remainingAmount: string;
  slots: number;
  claimedCount: number;
  /** Who opened it and for how much, oldest first. */
  claims: PacketClaimer[];
  splitMode: 'equal' | 'random';
  isPrivate: boolean;
  invitedCount: number;
  status: string;
  /** Null when the sender chose no deadline. */
  expiresAt: string | null;
  createdAt: string;
}

export interface MyClaim {
  code: string | null;
  theme: string | null;
  amount: string;
  claimedAt: string;
  txHash: string | null;
}

/**
 * Packets addressed to this user by phone number, which have no link to arrive by.
 *
 * Separate from `useMyPackets` because Home renders only this half and should not pull a
 * creator's whole history to do it.
 */
export function useInvitedPackets() {
  const { token } = useAuth();
  const [packets, setPackets] = useState<InvitedPacket[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!token) return;
    setIsLoading(true);
    try {
      const res = await fetch('/api/packet/invited', { headers: { Authorization: `Bearer ${token}` } });
      const data = await res.json();
      if (res.ok) setPackets(data.packets ?? []);
    } catch {
      // An empty inbox is the right failure mode for a section that only ever adds to a screen.
    } finally {
      setIsLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { packets, isLoading, refresh };
}

/** Packets this user sent, and packets they have opened. */
export function useMyPackets() {
  const { token } = useAuth();
  const [created, setCreated] = useState<MyPacket[]>([]);
  const [claimed, setClaimed] = useState<MyClaim[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!token) return;
    setIsLoading(true);
    try {
      const res = await fetch('/api/packet/mine', { headers: { Authorization: `Bearer ${token}` } });
      const data = await res.json();
      if (res.ok) {
        setCreated(data.created ?? []);
        setClaimed(data.claimed ?? []);
      }
    } catch {
      // Same: a history that fails to load stays empty rather than breaking the screen.
    } finally {
      setIsLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { created, claimed, isLoading, refresh };
}
