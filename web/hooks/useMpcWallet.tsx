'use client';

/**
 * Wallet backed by Turnkey key management (PRD Fase 4, revised — see docs/mpc-setup.md).
 *
 * This replaces the Web3Auth MPC integration after its `sapphire_devnet` signing infrastructure
 * proved unreliable under real testing: transactions would hang indefinitely with no error,
 * confirmed on-chain across multiple independent test sessions. Turnkey moves signing entirely
 * server-side — every wallet lives in its own Turnkey sub-organization, and Saku's backend,
 * authenticated with its own API keypair, signs on behalf of whichever session is currently
 * valid.
 *
 * The honest trade this makes: Saku's server can now always produce a signature given a valid
 * session, the same way a valid OTP always could here. That is a stronger claim than the
 * Web3Auth design aimed for (device share + network share, so the server alone was never
 * enough) — but it is a claim that is actually true today, which the old design's signing hang
 * was not. The private key material itself still never touches this process or any database; it
 * lives inside Turnkey's enclave.
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
  /** Get-or-create the wallet for the Saku session token issued by `/api/verify-otp`. */
  login: (sessionToken: string) => Promise<void>;
  /** An ethers signer whose signing calls go through Saku's backend to Turnkey. */
  getSigner: () => Promise<AbstractSigner>;
  logout: () => void;
}

const MpcWalletContext = createContext<MpcWalletContextValue | undefined>(undefined);

/**
 * An ethers signer that never holds key material. `signTransaction` posts the populated,
 * RLP-serialized transaction to `/api/mpc/sign`, which looks up this session's Turnkey
 * sub-organization and signs there. `AbstractSigner.sendTransaction` is what calls this — it
 * populates the transaction (nonce, gas, chainId) and hands `signTransaction` an already-built
 * `Transaction`, so there is nothing left to fill in here.
 */
class TurnkeyBackendSigner extends AbstractSigner {
  private readonly address: string;
  private readonly sessionToken: string;

  constructor(provider: Provider, address: string, sessionToken: string) {
    super(provider);
    this.address = address;
    this.sessionToken = sessionToken;
  }

  async getAddress(): Promise<string> {
    return this.address;
  }

  connect(provider: Provider | null): TurnkeyBackendSigner {
    return new TurnkeyBackendSigner(provider as Provider, this.address, this.sessionToken);
  }

  async signTransaction(tx: TransactionRequest): Promise<string> {
    const unsignedTransaction = Transaction.from(tx as never).unsignedSerialized;

    const response = await fetch('/api/mpc/sign', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.sessionToken}` },
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
  const { token } = useAuth();
  /** Guards the auto-login effect so a re-render never starts a second provisioning call. */
  const autoLoginStarted = useRef(false);
  const sessionTokenRef = useRef<string | null>(null);

  const [status, setStatus] = useState<MpcStatus>('idle');
  const [address, setAddress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const login = useCallback(async (sessionToken: string) => {
    setError(null);
    setStatus('connecting');
    try {
      const response = await fetch('/api/mpc/provision', {
        method: 'POST',
        headers: { Authorization: `Bearer ${sessionToken}` },
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}) as { error?: string });
        throw new Error(body.error || 'Could not provision wallet');
      }
      const { address: walletAddress } = (await response.json()) as { address: string };

      sessionTokenRef.current = sessionToken;
      setAddress(walletAddress);
      setStatus('connected');
    } catch (err) {
      setStatus('idle');
      setError(err instanceof Error ? err.message : 'Wallet login failed');
      throw err;
    }
  }, []);

  const getSigner = useCallback(async () => {
    if (!address || !sessionTokenRef.current) throw new Error('Wallet is not connected');
    const provider = new JsonRpcProvider(NETWORK_CONFIG.rpcUrl, NETWORK_CONFIG.chainId, {
      staticNetwork: true,
      pollingInterval: RECEIPT_POLLING_MS,
    });
    return new TurnkeyBackendSigner(provider, address, sessionTokenRef.current);
  }, [address]);

  const logout = useCallback(() => {
    sessionTokenRef.current = null;
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
    if (!token) return;
    if (status !== 'idle') return;

    // Set once and never cleared, including on failure — see the historical note in git blame
    // for why clearing this on error caused a re-trigger loop that froze the page. One attempt
    // per mount; screens that need a wallet surface `error` and their own retry button.
    autoLoginStarted.current = true;
    void login(token).catch(() => {});
  }, [token, status, login]);

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
