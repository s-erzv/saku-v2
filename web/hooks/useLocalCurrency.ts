'use client';

/**
 * The caller's own currency and today's rate for it.
 *
 * Derived from the phone number they signed up with — `/api/offramp/quote` resolves a country
 * from the session and returns that country's currency, so an Indonesian number gets IDR, a
 * Philippine one PHP, and so on, without anything being picked in the UI.
 *
 * Reusing the off-ramp quote's amount-less branch purely for its FX lookup implies no off-ramp
 * request; it is simply the one endpoint that already knows both halves. Extracted out of
 * `useCurrencyToggleAmount` so screens that only need to *display* a converted figure (a packet
 * claim, say) don't have to carry an input-state machine to get a rate.
 */

import { useEffect, useState } from 'react';

export interface LocalCurrencyInfo {
  code: string;
  symbol: string;
  /** Minor units, mirroring `lib/currency.ts`'s `CurrencyInfo` — 0 for IDR/VND, 2 otherwise. */
  decimals: 0 | 2;
  locale: string;
  /** Local currency units per 1 USD. */
  fxRate: number;
}

export function useLocalCurrency(signedIn: boolean) {
  const [currency, setCurrency] = useState<LocalCurrencyInfo | null>(null);

  useEffect(() => {
    if (!signedIn) return;
    let cancelled = false;

    fetch('/api/offramp/quote')
      .then((res) => res.json())
      .then((data) => {
        if (cancelled || !data?.fxRate) return;
        setCurrency({
          code: data.currency,
          symbol: data.symbol,
          decimals: data.decimals,
          locale: data.locale,
          fxRate: data.fxRate,
        });
      })
      .catch(() => {
        // No rate means no local-currency display. Every caller falls back to USDC, which is the
        // canonical figure anyway.
      });

    return () => {
      cancelled = true;
    };
  }, [signedIn]);

  return currency;
}

/** `12.5` USDC -> `Rp 203.000`. Returns null when there is no rate to convert with. */
export function formatLocal(amountUsdc: number, currency: LocalCurrencyInfo | null): string | null {
  if (!currency || !Number.isFinite(amountUsdc)) return null;
  return `${currency.symbol}${(amountUsdc * currency.fxRate).toLocaleString(currency.locale, {
    minimumFractionDigits: currency.decimals,
    maximumFractionDigits: currency.decimals,
  })}`;
}
