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
  'function lockForOfframp(uint256 amount, address isAuthenticated, bytes32 recipientPhoneHash, uint256 rateExpiry) returns (bytes32)',
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
  const { isAuthenticated } = useAuth();
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
          headers: { 'Content-Type': 'application/json' },
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
    [isAuthenticated]
  );

  /**
   * Approve if needed, lock, then hand off to the server to settle.
   *
   * `netUsdc` is what the user asked to have delivered (mirrors top up's fee-on-top model);
   * `grossUsdc` — `netUsdc` plus the fee, from the latest quote — is what actually gets locked
   * on-chain. Both travel to `/api/offramp/lock`: the server recomputes the fee forward from
   * `netUsdc` and checks it against the amount the lock transaction actually moved, so a stale
   * quote can't settle against numbers that no longer match.
   */
  const send = useCallback(
    async (netUsdc: string, grossUsdc: string, rail: Rail, phoneHash: string) => {
      setError(null);

      try {
        const value = parseUnits(grossUsdc, USDC_DECIMALS);
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

        // The lock itself only needs the response below to get a request id — settlement now
        // runs after that response on the server (`waitUntil` in /api/offramp/lock), so this
        // call returns as soon as the lock is recorded rather than after the swap and payout.
        setPhase('settling');
        const destination = recipientDestinationRef.current;
        const res = await fetch('/api/offramp/lock', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            txHash: lockTx.hash,
            rail,
            netUsdc: Number(netUsdc),
            recipientPhone: destination?.kind === 'phone' ? destination.phone : undefined,
            countryCode: destination?.kind === 'phone' ? destination.countryCode : undefined,
            bankCode: destination?.kind === 'bank' ? destination.bankCode : undefined,
            accountNumber: destination?.kind === 'bank' ? destination.accountNumber : undefined,
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Transfer could not be completed');

        const requestId = data.requestId as string;
        setResult({ requestId });

        // Settlement is happening in the background on the server now — find out how it went by
        // polling the same status route the "Claim refund" screen already used. Bounded well
        // past the 120s rate lock: if it is ever still unresolved past that, the row is either
        // settled (we will see it next poll) or eligible for refund (the route says so).
        const POLL_INTERVAL_MS = 2000;
        const POLL_TIMEOUT_MS = 3 * 60 * 1000;
        const startedAt = Date.now();
        // A single `refundable: true` read is not trusted on its own — a transient hiccup (a
        // slow poll, a clock edge right at the deadline) must never announce a failed transfer
        // that is in fact about to settle. Two reads in a row is enough to call it real without
        // meaningfully delaying the one case (a genuine settlement failure) it is for.
        let consecutiveRefundable = 0;
        // Set once the on-chain leg reports `settled` while the (mocked) fiat conversion is
        // still catching up — the server writes those two facts in separate updates, so a poll
        // can land in the gap. On-chain settlement is final at that point regardless of the fiat
        // leg's timing, so a timeout afterward must finalize as done, never as refundable.
        let settledPendingFiat: { settleTxHash?: string } | null = null;

        while (Date.now() - startedAt < POLL_TIMEOUT_MS) {
          await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));

          const statusRes = await fetch(`/api/offramp/${requestId}`, {
          });
          if (!statusRes.ok) continue; // transient — try again next tick
          const statusData = await statusRes.json();

          if (statusData.status === 'settled') {
            const rawFiat = statusData.fiat_amount_idr;
            const parsedFiat = rawFiat != null ? Number(rawFiat) : NaN;

            if (statusData.fiat_status === 'completed' && Number.isFinite(parsedFiat)) {
              setResult({
                requestId,
                settleTxHash: statusData.settle_tx_hash,
                fiatAmount: parsedFiat,
              });
              setPhase('done');
              return statusData;
            }

            // Chain settle is recorded but the fiat leg hasn't reported back yet — keep polling
            // for it within the same budget instead of treating a still-null amount as final.
            settledPendingFiat = { settleTxHash: statusData.settle_tx_hash };
            consecutiveRefundable = 0;
            continue;
          }

          if (statusData.refundable) {
            consecutiveRefundable += 1;
            if (consecutiveRefundable >= 2) {
              setResult({ requestId, refundableAfter: statusData.rate_expires_at });
              setPhase('needs-refund');
              return statusData;
            }
          } else {
            consecutiveRefundable = 0;
          }
          // Still `locked`, not yet confirmed past the rate-lock deadline twice in a row —
          // settlement is presumably still running server-side. Keep polling.
        }

        // The chain leg already settled — the request is done regardless of whether the mocked
        // fiat leg ever reports back, so this finalizes as done rather than needs-refund.
        if (settledPendingFiat) {
          setResult({ requestId, settleTxHash: settledPendingFiat.settleTxHash });
          setPhase('done');
          return null;
        }

        // Timed out without a definitive answer from this device — the request itself is not
        // lost (it is still `locked` on the server either way), so this reads as refundable-soon
        // rather than a hard failure.
        setResult({ requestId });
        setPhase('needs-refund');
        return null;
      } catch (err) {
        setPhase('failed');
        const message = err instanceof Error ? err.message : 'Transfer failed';
        setError(/insufficient funds/i.test(message) ? 'Not enough tBNB for gas.' : message);
        return null;
      }
    },
    [address, getSigner, isAuthenticated]
  );

  /** Claim back a lock that never settled. Only works once the rate lock has expired. */
  const requestRefund = useCallback(
    async (requestId: string) => {
      setError(null);
      try {
        const res = await fetch(`/api/offramp/${requestId}`, {
          method: 'POST',
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
    [isAuthenticated]
  );

  return { phase, error, lockTxHash, result, recipientHash, resolveRecipient, send, requestRefund, reset };
}
