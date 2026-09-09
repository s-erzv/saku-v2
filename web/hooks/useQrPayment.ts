'use client';

/**
 * QR pay — both sides of it.
 *
 * Requesting produces a short code; the QR encodes a claim URL, so a scan from any camera app
 * still lands somewhere useful rather than showing an opaque string.
 *
 * Paying is an ordinary transfer signed by the payer, then filed against the request. Nothing is
 * held by Saku at any point: the money goes wallet to wallet, and the request row is a receipt.
 */

import { useCallback, useState } from 'react';
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

export interface PaymentRequestDetails {
  code: string;
  payeeName: string;
  payeeAddress: string;
  amount: string | null;
  note: string | null;
  status: string;
  isPayee: boolean;
  payable: boolean;
}

export function useCreatePaymentRequest() {
  const { isAuthenticated } = useAuth();
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [code, setCode] = useState<string | null>(null);

  const create = useCallback(
    async (amount?: string, note?: string) => {
      if (!isAuthenticated) return null;
      setCreating(true);
      setError(null);

      try {
        const res = await fetch('/api/qr-payment/create', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ amount: amount || undefined, note: note || undefined }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Could not create the request');

        setCode(data.request.code);
        return data.request.code as string;
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not create the request');
        return null;
      } finally {
        setCreating(false);
      }
    },
    [isAuthenticated]
  );

  return { creating, error, code, create, reset: () => { setCode(null); setError(null); } };
}

export type PayPhase = 'idle' | 'loading' | 'paying' | 'done' | 'failed';

export function usePayRequest(code: string) {
  const { isAuthenticated } = useAuth();
  const { getSigner, address } = useMpcWallet();

  const [phase, setPhase] = useState<PayPhase>('loading');
  const [details, setDetails] = useState<PaymentRequestDetails | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [paidTxHash, setPaidTxHash] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!isAuthenticated) return;
    setPhase('loading');
    try {
      const res = await fetch(`/api/qr-payment/${code}`, {
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Request not found');
      setDetails(data);
      setPhase('idle');
    } catch (err) {
      setPhase('failed');
      setError(err instanceof Error ? err.message : 'Request not found');
    }
  }, [code, isAuthenticated]);

  const pay = useCallback(
    async (amountOverride?: string) => {
      if (!details) return null;
      setPhase('paying');
      setError(null);

      try {
        const amount = details.amount ?? amountOverride;
        if (!amount) throw new Error('Enter an amount to pay');

        const value = parseUnits(amount, USDC_DECIMALS);
        const signer = await getSigner();
        const usdc = new Contract(CONTRACTS.USDC, ERC20_ABI, signer);

        // Added on top: `value` is what the payee receives, the fee is extra.
        const fee = parseUnits(transferFee(Number(amount)).feeUsdc.toFixed(USDC_DECIMALS), USDC_DECIMALS);

        if (address) {
          const balance: bigint = await usdc.balanceOf(address);
          if (balance < value + fee) {
            throw new Error(
              `Not enough USDC: this payment needs ${formatUnits(value + fee, USDC_DECIMALS)} including the fee, wallet holds ${formatUnits(balance, USDC_DECIMALS)}.`
            );
          }
        }

        const treasury = await getTreasuryAddress(isAuthenticated);

        const tx = await usdc.transfer(details.payeeAddress, value);
        setPaidTxHash(tx.hash);
        await tx.wait();

        const feeTxHash = await chargePlatformFee({
          signer, usdcAddress: CONTRACTS.USDC, treasury, feeUnits: fee,
        });

        // Filed after confirmation — the route verifies the receipt, so an earlier call would
        // just 404 on a transaction the node has not mined.
        const res = await fetch(`/api/qr-payment/${code}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ txHash: tx.hash, feeTxHash }),
        });
        const data = await res.json();
        // The payment already happened on-chain; a bookkeeping failure must not read as one.
        if (!res.ok) console.warn('[qr-pay] receipt not recorded:', data.error);

        setPhase('done');
        return tx.hash as string;
      } catch (err) {
        setPhase('failed');
        const message = err instanceof Error ? err.message : 'Payment failed';
        setError(/insufficient funds/i.test(message) ? 'Not enough tBNB for gas.' : message);
        return null;
      }
    },
    [address, code, details, getSigner, isAuthenticated]
  );

  return { phase, details, error, paidTxHash, load, pay };
}
