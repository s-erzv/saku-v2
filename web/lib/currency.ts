/**
 * Which currency a user pays in.
 *
 * Saku is designed for Southeast Asia, not just Indonesia (PRD Section 6 covers ID, MY, SG, VN,
 * PH and TH), and `users.country_code` has been in the schema from the start. Hardcoding IDR
 * threw that away — a Malaysian user was quoted rupiah for no reason other than the default.
 *
 * The set below is the intersection of the PRD's target markets and the currencies the payment
 * gateway can actually charge in. Anything outside it falls back to Indonesia, which is where
 * the product is being piloted.
 */

import countries from '@/lib/country-codes.json';

export interface CurrencyInfo {
  /** ISO 4217 code, as sent to the gateway. */
  code: string;
  /** What to render in front of an amount. */
  symbol: string;
  /**
   * Minor units. IDR and VND are zero-decimal — quoting "Rp160.000,50" is wrong, and sending a
   * fractional amount to the gateway is rejected outright.
   */
  decimals: 0 | 2;
  locale: string;
}

/** ISO 3166-1 alpha-2 -> the currency Saku charges that country in. */
const CURRENCY_BY_COUNTRY: Record<string, CurrencyInfo> = {
  ID: { code: 'IDR', symbol: 'Rp', decimals: 0, locale: 'id-ID' },
  PH: { code: 'PHP', symbol: '₱', decimals: 2, locale: 'en-PH' },
  MY: { code: 'MYR', symbol: 'RM', decimals: 2, locale: 'ms-MY' },
  SG: { code: 'SGD', symbol: 'S$', decimals: 2, locale: 'en-SG' },
  TH: { code: 'THB', symbol: '฿', decimals: 2, locale: 'th-TH' },
  VN: { code: 'VND', symbol: '₫', decimals: 0, locale: 'vi-VN' },
};

export const DEFAULT_COUNTRY = 'ID';

export function isSupportedCountry(code: string | null | undefined): boolean {
  return !!code && code.toUpperCase() in CURRENCY_BY_COUNTRY;
}

/** Never throws: an unknown country is charged as Indonesia rather than blocked. */
export function currencyForCountry(countryCode: string | null | undefined): CurrencyInfo {
  const iso = (countryCode ?? '').toUpperCase();
  return CURRENCY_BY_COUNTRY[iso] ?? CURRENCY_BY_COUNTRY[DEFAULT_COUNTRY];
}

/**
 * Dialing code (`"62"`, `"+62"`) -> ISO country.
 *
 * Used at signup, which is the only moment Saku learns where a user is: the phone number is the
 * identity, so its country prefix is the signal. `+1` and `+7` map to several countries; the
 * first match is taken, and none of them are markets Saku targets, so it lands on the fallback
 * either way.
 */
export function countryFromDialCode(dialCode: string | null | undefined): string {
  if (!dialCode) return DEFAULT_COUNTRY;

  const normalized = `+${String(dialCode).replace(/\D/g, '')}`;
  const match = (countries as { name: string; dial_code: string; code: string }[]).find(
    (entry) => entry.dial_code === normalized
  );

  // Only remember countries Saku can actually charge; anything else stays on the default so a
  // stored value never implies support that does not exist.
  return match && isSupportedCountry(match.code) ? match.code : DEFAULT_COUNTRY;
}

/** Round to the currency's real precision — what the gateway will be asked to charge. */
export function roundToCurrency(amount: number, currency: CurrencyInfo): number {
  const factor = currency.decimals === 0 ? 1 : 100;
  return Math.round(amount * factor) / factor;
}

export function formatCurrency(amount: number, currency: CurrencyInfo): string {
  return `${currency.symbol}${amount.toLocaleString(currency.locale, {
    minimumFractionDigits: currency.decimals,
    maximumFractionDigits: currency.decimals,
  })}`;
}
