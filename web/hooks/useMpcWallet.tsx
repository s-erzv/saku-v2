'use client';

/**
 * Wallet backed by server-side key management (see docs/mpc-setup.md).
 *
 * This replaced the Web3Auth MPC integration after its `sapphire_devnet` signing infrastructure
 * proved unreliable under real testing: transactions would hang indefinitely with no error,
 * confirmed on-chain across multiple independent test sessions. Signing now happens entirely
 * server-side — every wallet lives with the signing provider (`lib/privy.ts`), and Saku's backend,
 * authenticated with its own API keypair, signs on behalf of whichever session is currently valid.
 *
 * The honest trade, and it is worth saying plainly rather than calling this non-custodial:
 * **Saku's server can produce a signature for any user's wallet whenever it chooses.** The key
 * material never touches this process or any database — it lives inside the provider's enclave —
 * but the authority to use it lives here. That is custodial, and the product copy says so.
 *
 * What bounds it is on the server, not in this file: `lib/tx-policy.ts` refuses anything that is
 * not one of the handful of calls Saku actually makes, `lib/spend-limits.ts` caps the daily total,
 * and every decision lands in `signing_events`.
 */

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AbstractSigner, JsonRpcProvider, Transaction, type Provider, type TransactionRequest } from 'ethers';
import { NETWORK_CONFIG, RECEIPT_POLLING_MS } from '@/lib/config';
import { useAuth } from './useAuth';

export type MpcStatus = 'idle' | 'connecting' | 'connected';

interface MpcWalletContextValue {
  status: MpcStatus;
  address: string | null;
  error: string | null;
  /** Get-or-create the wallet for the current session. */
  login: () => Promise<void>;
  /** An ethers signer whose signing calls go through Saku's backend to the custodian. */
  getSigner: () => Promise<AbstractSigner>;
  logout: () => void;
}

const MpcWalletContext = createContext<MpcWalletContextValue | undefined>(undefined);

/**
 * An ethers signer that never holds key material — or a session token.
 *
 * `signTransaction` posts the populated, RLP-serialized transaction to `/api/mpc/sign`, which
 * resolves the wallet from the session cookie the browser attaches on its own. It used to carry
 * the bearer token as a field on this object; it does not need one now, and not having one is the
 * point: there is no copy of the session for a script to find here either.
 *
 * `AbstractSigner.sendTransaction` is what calls this — it populates the transaction (nonce, gas,
 * chainId) and hands `signTransaction` an already-built `Transaction`, so there is nothing left to
 * fill in.
 */
class BackendSigner extends AbstractSigner {
  private readonly address: string;

  constructor(provider: Provider, address: string) {
    super(provider);
    this.address = address;
  }

  async getAddress(): Promise<string> {
    return this.address;
  }

  connect(provider: Provider | null): BackendSigner {
    return new BackendSigner(provider as Provider, this.address);
  }

  async signTransaction(tx: TransactionRequest): Promise<string> {
    const unsignedTransaction = Transaction.from(tx as never).unsignedSerialized;

    const response = await fetch('/api/mpc/sign', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ unsignedTransaction }),
    });

    if (!response.ok) {
      const body = await response.json().catch(() => ({}) as { error?: string });
      throw new Error(body.error || 'Signing failed');
    }

    const { signedTransaction } = (await response.json()) as { signedTransaction: string };
    return signedTransaction;
  }

  async signMessage(): Promise<string> {
    throw new Error('signMessage is not supported by this wallet');
  }

  async signTypedData(): Promise<string> {
    throw new Error('signTypedData is not supported by this wallet');
  }
}

export function MpcWalletProvider({ children }: { children: ReactNode }) {
  const { isAuthenticated } = useAuth();
  /** Guards the auto-login effect so a re-render never starts a second provisioning call. */
  const autoLoginStarted = useRef(false);

  const [status, setStatus] = useState<MpcStatus>('idle');
  const [address, setAddress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const login = useCallback(async () => {
    setError(null);
    setStatus('connecting');
    try {
      const response = await fetch('/api/mpc/provision', {
        method: 'POST',
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}) as { error?: string });
        throw new Error(body.error || 'Could not provision wallet');
      }
      const { address: walletAddress } = (await response.json()) as { address: string };

      setAddress(walletAddress);
      setStatus('connected');
    } catch (err) {
      setStatus('idle');
      setError(err instanceof Error ? err.message : 'Wallet login failed');
      throw err;
    }
  }, []);

  const getSigner = useCallback(async () => {
    if (!address) throw new Error('Wallet is not connected');
    const provider = new JsonRpcProvider(NETWORK_CONFIG.rpcUrl, NETWORK_CONFIG.chainId, {
      staticNetwork: true,
      pollingInterval: RECEIPT_POLLING_MS,
    });
    return new BackendSigner(provider, address);
  }, [address]);

  const logout = useCallback(() => {
    setAddress(null);
    setStatus('idle');
  }, []);

  /**
   * Bring the wallet up wherever a session exists, not just on the home screen.
   *
   * The session is what the wallet derives from, so the session is the right trigger — a shared
   * packet link, a QR payment, or a refresh on /staking should all find the wallet already
   * connected rather than telling the user to "finish setup from Home".
   */
  useEffect(() => {
    if (autoLoginStarted.current) return;
    if (!isAuthenticated) return;
    if (status !== 'idle') return;

    // Set once and never cleared, including on failure — see the historical note in git blame
    // for why clearing this on error caused a re-trigger loop that froze the page. One attempt
    // per mount; screens that need a wallet surface `error` and their own retry button.
    autoLoginStarted.current = true;
    void login().catch(() => {});
  }, [isAuthenticated, status, login]);

  const value = useMemo(
    () => ({ status, address, error, login, getSigner, logout }),
    [status, address, error, login, getSigner, logout]
  );

  return <MpcWalletContext.Provider value={value}>{children}</MpcWalletContext.Provider>;
}

export const useMpcWallet = () => {
  const context = useContext(MpcWalletContext);
  if (!context) throw new Error('useMpcWallet must be used within MpcWalletProvider');
  return context;
};
