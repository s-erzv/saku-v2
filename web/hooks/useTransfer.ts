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
import { chargePlatformFee, getTreasuryAddress } from '@/lib/platform-fee';
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

        // Checked before signing so an impossible transfer fails as a readable message rather
        // than an on-chain revert the user pays gas for.
        if (address) {
          const balance: bigint = await usdc.balanceOf(address);
          if (balance < value + fee) {
            throw new Error(
              `Not enough USDC: this transfer needs ${formatUnits(value + fee, USDC_DECIMALS)} including the fee, wallet holds ${formatUnits(balance, USDC_DECIMALS)}.`
            );
          }
        }

        // Fetched before signing so the fee leg does not wait on a round trip afterwards.
        const treasury = await getTreasuryAddress(isAuthenticated);

        const tx = await usdc.transfer(to, value);
        setTxHash(tx.hash);
        await tx.wait();

        const feeTxHash = await chargePlatformFee({
          signer,
          usdcAddress: CONTRACTS.USDC,
          treasury,
          feeUnits: fee,
        });

        // Record after confirmation: the route verifies the receipt, so submitting earlier
        // would just 404 on a transaction the node has not mined yet.
        await fetch('/api/transfer/record', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ txHash: tx.hash, feeTxHash }),
        }).catch(() => {
          /* History is a cache. The transfer already happened. */
        });

        setPhase('done');
        return tx.hash as string;
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
