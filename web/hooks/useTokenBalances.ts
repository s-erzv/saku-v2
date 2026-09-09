'use client';

/**
 * ERC20 balances for the connected MPC wallet, read straight from BSC Testnet.
 *
 * Reads go through a plain JSON-RPC provider rather than the MPC provider: fetching a balance
 * needs no signature, and routing it through the threshold layer would make a cheap `eth_call`
 * depend on the user's key shares being loaded.
 */

import { useCallback, useEffect, useState } from 'react';
import { Contract, JsonRpcProvider, formatUnits } from 'ethers';
import { NETWORK_CONFIG, TOKENS, RECEIPT_POLLING_MS } from '@/lib/config';

const ERC20_BALANCE_ABI = ['function balanceOf(address) view returns (uint256)'];

export interface TokenBalance {
  symbol: string;
  address: string;
  decimals: number;
  /** Human-readable amount, e.g. "12.5". */
  formatted: string;
  raw: bigint;
}

export function useTokenBalances(address: string | null) {
  const [balances, setBalances] = useState<TokenBalance[]>([]);
  const [nativeBalance, setNativeBalance] = useState('0');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!address) {
      setBalances([]);
      setNativeBalance('0');
      return;
    }

    setIsLoading(true);
    setError(null);
    try {
      const provider = new JsonRpcProvider(NETWORK_CONFIG.rpcUrl, NETWORK_CONFIG.chainId, {
        staticNetwork: true,
        pollingInterval: RECEIPT_POLLING_MS,
      });

      const [native, tokenBalances] = await Promise.all([
        provider.getBalance(address),
        Promise.all(
          TOKENS.filter((token) => token.address).map(async (token) => {
            const raw: bigint = await new Contract(token.address, ERC20_BALANCE_ABI, provider).balanceOf(address);
            return { ...token, raw, formatted: formatUnits(raw, token.decimals) };
          })
        ),
      ]);

      setNativeBalance(formatUnits(native, 18));
      setBalances(tokenBalances);
    } catch {
      setError('Could not read balances from the network');
    } finally {
      setIsLoading(false);
    }
  }, [address]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { balances, nativeBalance, isLoading, error, refresh };
}
