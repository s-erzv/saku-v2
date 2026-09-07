'use client';

/**
 * Grant a contract's ERC20 allowance ahead of time, while the user is still filling in the form.
 *
 * The measured cost of an approval is not the transaction — it mines in about two seconds. It is
 * the MPC signature in front of it, which is the latency PRD Section 9 flags as an open risk.
 * Doing it up front does not make signing faster; it moves the wait to a moment the user is
 * already occupied, so their first transfer feels like one step instead of two.
 *
 * Deliberately quiet. It never blocks the screen, never shows an error, and never blocks the
 * button: if it fails or has not finished, the normal in-flow approval still runs. The only
 * thing it can do is save time.
 */

import { useEffect, useRef, useState } from 'react';
import { Contract, JsonRpcProvider } from 'ethers';
import { useMpcWallet } from './useMpcWallet';
import { CONTRACTS, MAX_APPROVAL, NETWORK_CONFIG } from '@/lib/config';

const ERC20_ABI = [
  'function approve(address spender, uint256 amount) returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function balanceOf(address owner) view returns (uint256)',
];

/**
 * In-flight warm approvals, keyed by `owner:spender`.
 *
 * Module scope on purpose: a transfer started while the warm approval is still mining should
 * wait for it rather than sign a second, identical approval. `awaitWarmApproval` is how the
 * transfer hooks join that wait, and it is a no-op when nothing is in flight.
 */
const inFlight = new Map<string, Promise<void>>();

const key = (owner: string, spender: string) => `${owner.toLowerCase()}:${spender.toLowerCase()}`;

/**
 * How long the in-flow approval waits on a warm one before giving up on it.
 *
 * Not a tuning knob — a deadlock guard. Without it, a warm approval that hangs (an SDK call
 * that never resolves or rejects) would make `awaitWarmApproval` wait forever, and the button
 * that calls it would never come back. A warm approval saves time when it finishes; it must
 * never be able to cost more than this ceiling when it does not.
 */
const WARM_WAIT_TIMEOUT_MS = 8_000;

/** Await a warm approval already running for this pair, if any. Never throws, never hangs. */
export async function awaitWarmApproval(owner: string | null, spender: string): Promise<void> {
  if (!owner) return;
  const pending = inFlight.get(key(owner, spender));
  if (!pending) return;

  await Promise.race([
    pending.catch(() => {}),
    new Promise<void>((resolve) => setTimeout(resolve, WARM_WAIT_TIMEOUT_MS)),
  ]);
}

export function useWarmApproval(spender: string | undefined | null) {
  const { getSigner, address, status } = useMpcWallet();
  const attempted = useRef<string | null>(null);
  const [warmed, setWarmed] = useState(false);

  useEffect(() => {
    if (status !== 'connected' || !address || !spender) return;

    const pair = key(address, spender);
    if (attempted.current === pair) return;
    attempted.current = pair;

    const run = async () => {
      try {
        const provider = new JsonRpcProvider(NETWORK_CONFIG.rpcUrl, NETWORK_CONFIG.chainId, {
          staticNetwork: true,
        });
        const readOnly = new Contract(CONTRACTS.USDC, ERC20_ABI, provider);

        const [allowance, balance]: [bigint, bigint] = await Promise.all([
          readOnly.allowance(address, spender),
          readOnly.balanceOf(address),
        ]);

        // Nothing to spend means nothing worth approving — and gas here is sponsored, so a
        // pointless approval spends the drip that a real transaction will need later.
        if (balance === BigInt(0)) return;
        if (allowance >= balance) {
          setWarmed(true);
          return;
        }

        const signer = await getSigner();
        const usdc = new Contract(CONTRACTS.USDC, ERC20_ABI, signer);
        const tx = await usdc.approve(spender, MAX_APPROVAL);
        await tx.wait();
        setWarmed(true);
      } catch (err) {
        // Silent to the *user* by design — the in-flow approval is the fallback, and a failure
        // here should never put an error in front of someone who has not asked for anything
        // yet. Logged, not swallowed: a warm approval that silently never lands is exactly as
        // slow as having no warm approval at all, and that failure mode is invisible without this.
        console.warn('[useWarmApproval] warm approval failed, falling back to in-flow approve:', err);
        attempted.current = null;
      }
    };

    const promise = run().finally(() => inFlight.delete(pair));
    inFlight.set(pair, promise);
  }, [status, address, spender, getSigner]);

  return { warmed };
}
