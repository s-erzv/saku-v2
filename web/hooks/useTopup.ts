'use client';

/**
 * Topup: create a Xendit invoice, hand the browser to their checkout page, then wait for the
 * on-chain payout when the user comes back.
 *
 * No payment SDK ships to the browser — the whole payment happens on Xendit's own page, so
 * there is nothing here to tamper with and nothing to load before a user can pay.
 *
 * The wait is a poll rather than a push. Xendit notifies the webhook, but the browser has no
 * channel to learn about that, and on localhost there is no reachable webhook at all. Polling
 * `/api/topup/status/<id>` covers both cases.
 */

import { useCallback, useState } from 'react';
import { useAuth } from './useAuth';

export type TopupPhase =
  | 'idle'
  /** Creating the invoice on our side. */
  | 'creating'
  /** Redirecting to, or returning from, the gateway. */
  | 'redirecting'
  /** Payment reported; waiting for the payout to land. */
  | 'settling'
  | 'done'
  | 'failed';

export interface TopupState {
  phase: TopupPhase;
  orderId: string | null;
  payoutTxHash: string | null;
  error: string | null;
}

const POLL_INTERVAL_MS = 2500;
/** Long enough for a gateway settlement plus a BSC testnet block; short enough to fail visibly. */
const POLL_TIMEOUT_MS = 180_000;

export function useTopup() {
  const { isAuthenticated } = useAuth();
  const [state, setState] = useState<TopupState>({
    phase: 'idle',
    orderId: null,
    payoutTxHash: null,
    error: null,
  });

  const reset = useCallback(() => {
    setState({ phase: 'idle', orderId: null, payoutTxHash: null, error: null });
  }, []);

  /** Poll until the topup reaches a terminal state. */
  const waitForSettlement = useCallback(
    async (orderId: string): Promise<void> => {
      setState((s) => ({ ...s, phase: 'settling', orderId }));
      const deadline = Date.now() + POLL_TIMEOUT_MS;

      while (Date.now() < deadline) {
        try {
          const res = await fetch(`/api/topup/status/${orderId}`, {
          });
          const data = await res.json();

          if (res.ok) {
            if (data.status === 'completed') {
              setState((s) => ({ ...s, phase: 'done', payoutTxHash: data.payoutTxHash ?? null }));
              return;
            }
            if (data.status === 'expired') {
              setState((s) => ({ ...s, phase: 'failed', error: 'This payment expired.' }));
              return;
            }
            // `failed` here means the payout failed, not the payment — the next poll retries
            // it, so it is not terminal until the timeout.
          }
        } catch {
          // A dropped request mid-poll is not a failure; the next tick tries again.
        }

        await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
      }

      setState((s) => ({
        ...s,
        phase: 'failed',
        error: 'Payment received, but the balance has not arrived yet. Check again from Home in a moment.',
      }));
    },
    [isAuthenticated]
  );

  /** Create the invoice and send the browser to the gateway. Does not return on success. */
  const startTopup = useCallback(
    async (amountUsdc: number) => {
      if (!isAuthenticated) {
        setState((s) => ({ ...s, phase: 'failed', error: 'Your session expired — please sign in again.' }));
        return;
      }

      setState({ phase: 'creating', orderId: null, payoutTxHash: null, error: null });

      try {
        const res = await fetch('/api/topup/create-payment', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ amountUsdc }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Could not start the payment');

        setState({ phase: 'redirecting', orderId: data.orderId, payoutTxHash: null, error: null });

        // Xendit redirects back to /topup/callback/<orderId>, which resumes the poll.
        window.location.href = data.checkoutUrl;
      } catch (err) {
        setState((s) => ({
          ...s,
          phase: 'failed',
          error: err instanceof Error ? err.message : 'Top up failed',
        }));
      }
    },
    [isAuthenticated]
  );

  return { ...state, startTopup, waitForSettlement, reset };
}
