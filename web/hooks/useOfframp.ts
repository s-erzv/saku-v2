'use client';

/**
 * Cross-rail transfer — the PRD's core use case, client side.
 *
 * Two signatures happen on the user's device, in order: an ERC20 approval for the escrow, then
 * `lockForOfframp`. Both go through the MPC layer, so the server never holds anything that
 * could produce them. Once the lock is mined, the server takes over: it reads the lock out of
 * the receipt, swaps on PancakeSwap, and runs the simulated fiat legs.
 *
 * The approval is a separate transaction because that is how ERC20 works — the escrow pulls
 * with `safeTransferFrom`, which requires an allowance to exist first. It is granted once, for
 * an unlimited amount (see `MAX_APPROVAL`), so only a user's *first* cross-rail transfer costs
 * two signatures. Every one after it is a single signature and roughly half the wait.
 */

import { useCallback, useRef, useState } from 'react';
import { Contract, parseUnits } from 'ethers';
import { useAuth } from './useAuth';
import { useMpcWallet } from './useMpcWallet';
import { CONTRACTS, MAX_APPROVAL } from '@/lib/config';
import { awaitWarmApproval } from './useWarmApproval';
import type { Rail } from '@/lib/mock-fiat';

const USDC_DECIMALS = 6;

const ERC20_ABI = [
  'function approve(address spender, uint256 amount) returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function balanceOf(address owner) view returns (uint256)',
];

const ESCROW_ABI = [
  'function lockForOfframp(uint256 amount, address token, bytes32 recipientPhoneHash, uint256 rateExpiry) returns (bytes32)',
];

/** Matches `RATE_EXPIRY_SECONDS` in lib/escrow.ts — the contract enforces the 30-120s bounds. */
const RATE_EXPIRY_SECONDS = 120;

export type OfframpPhase =
  | 'idle'
  /** Resolving the destination number. */
  | 'resolving'
  | 'ready'
  /** Signing the ERC20 approval. */
  | 'approving'
  /** Signing and sending the lock. */
  | 'locking'
  /** Server is swapping on-chain and running the fiat legs. */
  | 'settling'
  | 'done'
  /** Locked but not settled — recoverable via refund once the rate lock expires. */
  | 'needs-refund'
  | 'failed';

export interface OfframpResult {
  requestId: string;
  settleTxHash?: string;
  fiatAmount?: number;
  currency?: string;
  refundableAfter?: string;
}

export function useOfframp() {
  const { token } = useAuth();
  const { getSigner, address } = useMpcWallet();

  const [phase, setPhase] = useState<OfframpPhase>('idle');
  const [error, setError] = useState<string | null>(null);
  const [lockTxHash, setLockTxHash] = useState<string | null>(null);
  const [result, setResult] = useState<OfframpResult | null>(null);
  /** The recipient's identifier hash, resolved server-side so the client never derives it. */
  const [recipientHash, setRecipientHash] = useState<string | null>(null);
  /**
   * The plain destination — a phone number for e-wallet rails, a bank code + account number for
   * `bank` — held only in memory for this session. Needed at settlement time so a real payout
   * has somewhere to go — see the note in `/api/offramp/lock`. Never sent anywhere except that
   * one settlement call, and never the value this hook itself hashes or persists.
   */
  const recipientDestinationRef = useRef<
    | { kind: 'phone'; phone: string; countryCode: string }
    | { kind: 'bank'; bankCode: string; accountNumber: string }
    | null
  >(null);

  const reset = useCallback(() => {
    setPhase('idle');
    setError(null);
    setLockTxHash(null);
    setResult(null);
    setRecipientHash(null);
    recipientDestinationRef.current = null;
  }, []);

  /**
   * Hash the destination — a phone number for e-wallet rails, a bank code + account number for
   * `bank`. Reuses the transfer resolver's shape but never checks whether it belongs to a Saku
   * user — for a cross-rail transfer it usually does not. That is the whole point: the recipient
   * needs a GoPay account or a bank account, not a Saku wallet.
   */
  const resolveRecipient = useCallback(
    async (
      rail: Rail,
      destination: { phone: string; countryCode: string } | { bankCode: string; accountNumber: string }
    ) => {
      setPhase('resolving');
      setError(null);

      try {
        const res = await fetch('/api/offramp/recipient', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ rail, ...destination }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Could not read that destination');

        setRecipientHash(data.recipientHash);
        recipientDestinationRef.current =
          'phone' in destination
            ? { kind: 'phone', phone: destination.phone, countryCode: destination.countryCode }
            : { kind: 'bank', bankCode: destination.bankCode, accountNumber: destination.accountNumber };
        setPhase('ready');
        return data.recipientHash as string;
      } catch (err) {
        setPhase('failed');
        setError(err instanceof Error ? err.message : 'Could not read that destination');
        return null;
      }
    },
    [token]
  );

  /** Approve if needed, lock, then hand off to the server to settle. */
  const send = useCallback(
    async (amountUsdc: string, rail: Rail, phoneHash: string) => {
      setError(null);

      try {
        const value = parseUnits(amountUsdc, USDC_DECIMALS);
        const signer = await getSigner();
        const usdc = new Contract(CONTRACTS.USDC, ERC20_ABI, signer);
        const escrowAddress = process.env.NEXT_PUBLIC_ESCROW_ADDRESS as string;

        if (address) {
          const balance: bigint = await usdc.balanceOf(address);
          if (balance < value) throw new Error('Not enough USDC in your wallet.');
        }

        // If the screen already started warming this allowance, join that wait rather than
        // signing a second, identical approval.
        setPhase('approving');
        await awaitWarmApproval(address, escrowAddress);

        // Approve once, for everything. A per-transfer approval means a second MPC signature
        // every single time, which is the slowest part of this flow by a wide margin — the
        // approval transaction itself mines in about two seconds.
        const current: bigint = address
          ? await usdc.allowance(address, escrowAddress)
          : BigInt(0);

        if (current < value) {
          const approval = await usdc.approve(escrowAddress, MAX_APPROVAL);
          await approval.wait();
        }

        setPhase('locking');
        const escrow = new Contract(escrowAddress, ESCROW_ABI, signer);
        const lockTx = await escrow.lockForOfframp(
          value,
          CONTRACTS.USDC,
          phoneHash,
          RATE_EXPIRY_SECONDS
        );
        setLockTxHash(lockTx.hash);
        await lockTx.wait();

        // The clock is running now: the contract will refuse to settle after 120 seconds, so
        // this call is not deferred or retried in the background.
        setPhase('settling');
        const destination = recipientDestinationRef.current;
        const res = await fetch('/api/offramp/lock', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({
            txHash: lockTx.hash,
            rail,
            recipientPhone: destination?.kind === 'phone' ? destination.phone : undefined,
            countryCode: destination?.kind === 'phone' ? destination.countryCode : undefined,
            bankCode: destination?.kind === 'bank' ? destination.bankCode : undefined,
            accountNumber: destination?.kind === 'bank' ? destination.accountNumber : undefined,
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Transfer could not be completed');

        setResult({
          requestId: data.requestId,
          settleTxHash: data.settleTxHash,
          fiatAmount: data.fiatAmount,
          currency: data.currency,
          refundableAfter: data.refundableAfter,
        });

        // A lock that did not settle is not a lost payment — it is a refund waiting on the
        // rate-lock deadline, and the UI says so rather than showing a generic failure.
        setPhase(data.status === 'settled' ? 'done' : 'needs-refund');
        return data;
      } catch (err) {
        setPhase('failed');
        const message = err instanceof Error ? err.message : 'Transfer failed';
        setError(/insufficient funds/i.test(message) ? 'Not enough tBNB for gas.' : message);
        return null;
      }
    },
    [address, getSigner, token]
  );

  /** Claim back a lock that never settled. Only works once the rate lock has expired. */
  const requestRefund = useCallback(
    async (requestId: string) => {
      setError(null);
      try {
        const res = await fetch(`/api/offramp/${requestId}`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Refund failed');
        setPhase('failed');
        setError('Funds returned to your wallet.');
        return data;
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Refund failed');
        return null;
      }
    },
    [token]
  );

  return { phase, error, lockTxHash, result, recipientHash, resolveRecipient, send, requestRefund, reset };
}
