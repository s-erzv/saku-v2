'use client';

/**
 * An amount that can be typed either in USDC or in the caller's own local currency.
 *
 * Reuses the off-ramp quote's amount-less branch purely for its FX rate lookup (same pattern
 * already used by the split-bill receipt scanner) — no off-ramp request is implied by using
 * this. `amountUsdc` is always the canonical value; everything downstream of an amount field
 * (validation, submission, on-chain amounts) should read that and stay unaware of which unit the
 * user is actually typing in.
 */

import { useCallback, useState } from 'react';
import { useLocalCurrency, type LocalCurrencyInfo } from './useLocalCurrency';

export type { LocalCurrencyInfo };

export type AmountUnit = 'usdc' | 'local';

export function useCurrencyToggleAmount(token: string | null) {
  const currency = useLocalCurrency(token);
  const [unit, setUnit] = useState<AmountUnit>('usdc');
  const [amountUsdc, setAmountUsdc] = useState('');
  const [amountLocal, setAmountLocal] = useState('');

  const setUsdcInput = useCallback((raw: string) => {
    setAmountUsdc(raw.replace(/[^\d.]/g, ''));
  }, []);

  const setLocalInput = useCallback(
    (raw: string) => {
      const cleaned = raw.replace(/[^\d.]/g, '');
      setAmountLocal(cleaned);
      const n = Number(cleaned);
      setAmountUsdc(currency && Number.isFinite(n) && n > 0 ? (n / currency.fxRate).toFixed(6) : '');
    },
    [currency]
  );

  /** Converts the current canonical amount into the unit being switched to, so toggling never
   *  resets the field to zero. */
  const toggleUnit = useCallback(() => {
    if (!currency) return;
    setUnit((prev) => {
      if (prev === 'usdc') {
        const n = Number(amountUsdc);
        setAmountLocal(Number.isFinite(n) && n > 0 ? (n * currency.fxRate).toFixed(currency.decimals) : '');
        return 'local';
      }
      return 'usdc';
    });
  }, [currency, amountUsdc]);

  /** Sets the canonical amount directly, in USDC, and switches display to that unit — for a
   *  value that arrives already in USDC from somewhere other than this field (e.g. OCR). */
  const setAmountUsdcDirect = useCallback((value: string) => {
    setAmountUsdc(value);
    setAmountLocal('');
    setUnit('usdc');
  }, []);

  const reset = useCallback(() => {
    setAmountUsdc('');
    setAmountLocal('');
    setUnit('usdc');
  }, []);

  return {
    currency,
    unit,
    toggleUnit,
    amountUsdc,
    setAmountUsdcDirect,
    reset,
    displayValue: unit === 'usdc' ? amountUsdc : amountLocal,
    setDisplayValue: unit === 'usdc' ? setUsdcInput : setLocalInput,
    unitLabel: unit === 'usdc' ? 'USDC' : (currency?.code ?? 'USDC'),
  };
}
