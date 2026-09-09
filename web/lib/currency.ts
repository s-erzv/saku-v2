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

/** Currency code -> info, for the cases that start from the money rather than the country. */
const CURRENCY_BY_CODE: Record<string, CurrencyInfo> = Object.fromEntries(
  Object.values(CURRENCY_BY_COUNTRY).map((c) => [c.code, c])
);

/**
 * Which currencies the payment gateway can actually put on a charge.
 *
 * This is a different question from "which currencies does Saku support", and conflating the
 * two is what produced a Malaysian user being quoted a price in MYR, shown a full fee
 * breakdown, and only then hitting a raw gateway error at checkout: `currency MYR is not
 * configured in your settings yet`. Xendit calls this the *presentment* currency, and it is
 * fixed by the country the merchant account is incorporated in — an Indonesia-scoped account
 * can only present IDR, no matter how many currency balances it opens. That is an account
 * question with Xendit, not something any amount of code can arrange.
 *
 * So Saku prices in the user's own currency and charges in one this account can actually bill,
 * showing both before the user commits. When MYR is eventually enabled, add it here and the
 * conversion stops happening on its own — no code change.
 *
 * Order matters: the first entry is the fallback everything unsupported is charged in.
 */
const DEFAULT_PRESENTMENT_CURRENCIES = ['IDR'];

function presentmentCurrencies(): string[] {
  const configured = process.env.XENDIT_PRESENTMENT_CURRENCIES?.trim()
    .split(',')
    .map((code) => code.trim().toUpperCase())
    .filter((code) => code in CURRENCY_BY_CODE);

  return configured?.length ? configured : DEFAULT_PRESENTMENT_CURRENCIES;
}

/** Whether the gateway can bill this currency directly. */
export function isChargeableCurrency(code: string): boolean {
  return presentmentCurrencies().includes(code.toUpperCase());
}

/**
 * The currency the gateway will actually be asked to charge for a price quoted in `display`.
 *
 * Returns `display` untouched whenever the account can bill it, which is the only branch that
 * runs once Xendit enables the rest.
 */
export function chargeCurrencyFor(display: CurrencyInfo): CurrencyInfo {
  if (isChargeableCurrency(display.code)) return display;
  return CURRENCY_BY_CODE[presentmentCurrencies()[0]] ?? CURRENCY_BY_COUNTRY[DEFAULT_COUNTRY];
}

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

/**
 * ISO country -> dialing code, the inverse of {@link countryFromDialCode}.
 *
 * Every screen that asks for someone else's phone number opened on `+62`, hardcoded, no matter
 * who was looking at it. A Malaysian sending money to another Malaysian had to change the
 * country on every single transfer, split bill and cash-out, and forgetting to does not fail
 * loudly — it silently resolves to a different person's identity, because the dialing code is
 * part of what gets hashed. The sender's own country is the only sane default: people
 * overwhelmingly pay people in the country they live in.
 *
 * Unlike `countryFromDialCode` this is not restricted to supported countries. It answers "what
 * prefix does this country dial with", which is true regardless of whether Saku can charge
 * there, and the account's stored country is already constrained to the supported set anyway.
 */
export function dialCodeFromCountry(countryCode: string | null | undefined): string {
  const iso = (countryCode ?? '').toUpperCase();
  const match = (countries as { name: string; dial_code: string; code: string }[]).find(
    (entry) => entry.code === iso
  );
  return match?.dial_code ?? DEFAULT_DIAL_CODE;
}

/** Where the country pickers start before an account is known, and if one is ever unmapped. */
export const DEFAULT_DIAL_CODE = '+62';

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
