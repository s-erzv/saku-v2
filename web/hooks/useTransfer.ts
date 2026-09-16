'use client';

/**
 * Saku-to-Saku transfer.
 *
 * The signature happens on the user's device, through the MPC threshold layer — the server sees
 * a finished transaction hash and never a key. That is the whole point of v2, and it is why
 * this lives in a hook rather than an API route: there is no server-side path that could sign
 * this even if someone wanted one.
 *
 * Recording history afterwards is best-effort. The transfer is real once the chain confirms it;
 * a failed cache write must not make the user think their money vanished.
 */

import { useCallback, useState } from 'react';
import { Contract, formatUnits, parseUnits } from 'ethers';
import { useAuth } from './useAuth';
import { useMpcWallet } from './useMpcWallet';
import { CONTRACTS } from '@/lib/config';
import { chargeFeeAndAttach, getTreasuryAddress } from '@/lib/platform-fee';
import { transferFee } from '@/lib/fees';

const ERC20_ABI = [
  'function transfer(address to, uint256 amount) returns (bool)',
  'function balanceOf(address owner) view returns (uint256)',
];

const USDC_DECIMALS = 6;

export interface ResolvedRecipient {
  address: string;
  displayName: string | null;
  /** Their profile picture, so the confirm step shows a person and not a placeholder glyph. */
  avatarUrl: string | null;
  phoneHash: string;
}

export type TransferPhase =
  | 'idle'
  /** Looking the number up. */
  | 'resolving'
  /** Recipient known, waiting for the user to confirm. */
  | 'ready'
  /** MPC is signing and the tx is in flight. */
  | 'sending'
  | 'done'
  | 'failed';

export function useTransfer() {
  const { isAuthenticated } = useAuth();
  const { getSigner, address } = useMpcWallet();

  const [phase, setPhase] = useState<TransferPhase>('idle');
  const [recipient, setRecipient] = useState<ResolvedRecipient | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reset = useCallback(() => {
    setPhase('idle');
    setRecipient(null);
    setTxHash(null);
    setError(null);
  }, []);

  const resolveRecipient = useCallback(
    async (phone: string, countryCode: string) => {
      setPhase('resolving');
      setError(null);
      setRecipient(null);

      try {
        const res = await fetch('/api/transfer/resolve', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ phone, countryCode }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Could not look up that number');

        if (!data.found) {
          setPhase('failed');
          setError(
            data.reason === 'no_wallet'
              ? 'That number is registered but its wallet is not active yet.'
              : 'That number is not on Saku yet.'
          );
          return null;
        }

        const resolved: ResolvedRecipient = {
          address: data.address,
          displayName: data.displayName,
          avatarUrl: data.avatarUrl ?? null,
          phoneHash: data.phoneHash,
        };
        setRecipient(resolved);
        setPhase('ready');
        return resolved;
      } catch (err) {
        setPhase('failed');
        setError(err instanceof Error ? err.message : 'Could not look up that number');
        return null;
      }
    },
    [isAuthenticated]
  );

  /** Sign and send. `amount` is human-readable USDC, e.g. "1.25". */
  const send = useCallback(
    async (to: string, amount: string) => {
      setPhase('sending');
      setError(null);

      try {
        const value = parseUnits(amount, USDC_DECIMALS);
        // Added on top: `value` is what the recipient gets, `fee` is extra, and the wallet needs
        // both. Charging the total against the balance check is what stops a transfer that
        // succeeds and then cannot pay its own fee.
        const fee = parseUnits(transferFee(Number(amount)).feeUsdc.toFixed(USDC_DECIMALS), USDC_DECIMALS);
        const signer = await getSigner();
        const usdc = new Contract(CONTRACTS.USDC, ERC20_ABI, signer);

        // Two independent reads that used to run one after the other for no reason — the balance
        // is on-chain, the treasury is a Saku route, and neither is an input to the other. The
        // balance is checked before signing so an impossible transfer fails as a readable message
        // rather than an on-chain revert the user pays gas for; the treasury is fetched now so the
        // fee leg does not wait on a round trip afterwards.
        const [balance, treasury] = await Promise.all([
          address ? (usdc.balanceOf(address) as Promise<bigint>) : Promise.resolve(null),
          getTreasuryAddress(isAuthenticated),
        ]);

        if (balance !== null && balance < value + fee) {
          throw new Error(
            `Not enough USDC: this transfer needs ${formatUnits(value + fee, USDC_DECIMALS)} including the fee, wallet holds ${formatUnits(balance, USDC_DECIMALS)}.`
          );
        }

        const tx = await usdc.transfer(to, value);
        setTxHash(tx.hash);

        // The receipt screen is proof, not an optimistic "sent" toast, so it appears only after
        // the chain confirms this hash. Fee collection and history are Saku bookkeeping and stay
        // behind that screen instead of making someone wait to see proof of a payment that has
        // already settled.
        const confirmation = (async () => {
          try {
            await tx.wait();
            setPhase('done');

            void (async () => {
              // Recorded after confirmation: the route verifies the receipt, so submitting
              // earlier would just 404 on a transaction the node has not mined yet. It goes
              // first so the fee-hash attachment cannot beat the insert in a race.
              const recorded = await fetch('/api/transfer/record', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ txHash: tx.hash }),
                // The request has to outlive the screen that started it. A send ends on a
                // receipt the user reads and then navigates away from.
                keepalive: true,
              }).catch(() => null);

              if (recorded?.ok) {
                chargeFeeAndAttach({
                  signer,
                  usdcAddress: CONTRACTS.USDC,
                  treasury,
                  feeUnits: fee,
                  txHash: tx.hash,
                });
              }
            })();

            return tx.hash;
          } catch (err) {
            setPhase('failed');
            const message = err instanceof Error ? err.message : 'Transaction failed on chain';
            setError(/insufficient funds/i.test(message) ? 'Not enough tBNB for gas.' : message);
            // The visible error is state-driven. Do not rethrow from this detached confirmation
            // promise: once a transaction has broadcast, the click handler is no longer awaiting
            // it and a rejection would become an unhandled browser error.
            return null;
          }
        })();

        return { txHash: tx.hash, confirmation };
      } catch (err) {
        setPhase('failed');
        const message = err instanceof Error ? err.message : 'Transfer failed';
        // ethers wraps chain errors in long strings; the common ones get a plain translation.
        setError(
          /insufficient funds/i.test(message)
            ? 'Not enough tBNB for gas.'
            : message
        );
        return null;
      }
    },
    [address, getSigner, isAuthenticated]
  );

  return { phase, recipient, txHash, error, resolveRecipient, send, reset };
}
