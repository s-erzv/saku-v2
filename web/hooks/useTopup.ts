'use client';

/**
 * Topup: create a Xendit invoice, open their checkout beside the app, then wait for the on-chain
 * payout.
 *
 * No payment SDK ships to the browser — the whole payment happens on Xendit's own page, so there
 * is nothing here to tamper with and nothing to load before a user can pay.
 *
 * Checkout opens in a **second window rather than replacing this one**. It used to assign
 * `window.location.href`, which tore the app down: the session, the wallet, the poll and every
 * loaded screen were discarded, the user paid, and then a cold boot of the whole application ran
 * again on the way back through `/topup/callback/<id>` before anything could tell them their
 * balance had arrived. Nothing about paying required any of that. Keeping this window alive means
 * the poll below is already running while they pay, and the balance lands on a screen that never
 * went away.
 *
 * The window is opened **before** the invoice request, not after. A popup only escapes the popup
 * blocker when it is opened during the click that asked for it, and a window opened after an
 * `await` no longer counts as one. So it opens empty, holds a line of text while the invoice is
 * created, and is then pointed at the checkout URL. If the browser blocked it anyway — some
 * mobile browsers refuse regardless — the old full-page redirect is still there as the fallback,
 * because a blocked popup must not become a top up that cannot be paid.
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

/**
 * How long to keep polling after the checkout window closes.
 *
 * Closing it is the normal end of a successful payment, not a signal of abandonment — the gateway
 * shows its own confirmation and people dismiss it. This is the window in which a webhook that
 * was already in flight can still arrive before the topup is called off.
 */
const ABANDONED_GRACE_MS = 15_000;

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

  /**
   * Poll until the topup reaches a terminal state.
   *
   * `checkout` is the window the user is paying in, when there is one. It is watched rather than
   * trusted: a closed window is not a failed payment — people close the tab the moment the
   * gateway says "success" — so this keeps polling for a short grace period afterwards, long
   * enough for a webhook that was already on its way to land.
   */
  const waitForSettlement = useCallback(
    async (orderId: string, checkout?: Window | null): Promise<void> => {
      setState((s) => ({ ...s, phase: 'settling', orderId }));
      const deadline = Date.now() + POLL_TIMEOUT_MS;
      let closedAt: number | null = null;

      while (Date.now() < deadline) {
        if (checkout?.closed && closedAt === null) closedAt = Date.now();
        if (closedAt !== null && Date.now() - closedAt > ABANDONED_GRACE_MS) {
          setState((s) => ({
            ...s,
            phase: 'failed',
            error: 'The payment window closed before the payment came through. Nothing was charged.',
          }));
          return;
        }

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

  /** Create the invoice and open the gateway beside the app. */
  const startTopup = useCallback(
    async (amountUsdc: number) => {
      if (!isAuthenticated) {
        setState((s) => ({ ...s, phase: 'failed', error: 'Your session expired — please sign in again.' }));
        return;
      }

      // Opened here, synchronously, and not one line later: this call is still inside the click
      // that asked for it, which is the only thing that gets a window past a popup blocker.
      // There is no URL to send it to yet, so it holds a line of text until there is.
      const checkout = window.open('', 'saku-topup', 'width=480,height=760,noopener=no');
      checkout?.document?.write(
        '<!doctype html><meta charset="utf-8"><title>Saku</title>' +
          '<body style="margin:0;display:grid;place-items:center;height:100vh;' +
          'font:14px system-ui,sans-serif;color:#14120E;background:#F4F3F0">' +
          'Preparing your payment…</body>'
      );

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

        if (!checkout || checkout.closed) {
          // Blocked, or dismissed while the invoice was being created. The full-page redirect is
          // the worse experience and the reason this hook was changed, but an unpayable invoice
          // is worse still — so it stays as the fallback. Xendit returns to
          // /topup/callback/<orderId>, which resumes the poll from a cold start.
          window.location.href = data.checkoutUrl;
          return;
        }

        checkout.location.href = data.checkoutUrl;

        // This window never went anywhere, so the poll can simply run here — no callback route,
        // no reload, and the balance appears on the screen the user was already looking at.
        await waitForSettlement(data.orderId, checkout);
        if (!checkout.closed) checkout.close();
      } catch (err) {
        if (checkout && !checkout.closed) checkout.close();
        setState((s) => ({
          ...s,
          phase: 'failed',
          error: err instanceof Error ? err.message : 'Top up failed',
        }));
      }
    },
    [isAuthenticated, waitForSettlement]
  );

  return { ...state, startTopup, waitForSettlement, reset };
}
