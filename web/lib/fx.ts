/**
 * Live USD -> local currency rates.
 *
 * A hardcoded rate is wrong the day after it is written, and this one decides what a user is
 * actually charged. Rates come from open.er-api.com (free, no key, daily refresh) and are cached
 * in module scope so a burst of quotes costs one request.
 *
 * Three levels of freshness, and the caller is told which one it got:
 *
 *  - `live`   — fetched within the last hour.
 *  - `stale`  — the API is unreachable but a rate from the last day is still in memory. Better
 *               than refusing a payment over a provider outage; the drift in a day is small.
 *  - `fallback` — neither, so an approximate constant is used. Flagged all the way to the UI,
 *               because quoting a price from a guess without saying so is not acceptable.
 *
 * Whatever is used, the rate is written onto the topup row, so history always says what the
 * user was actually charged at.
 */

import { getSupabaseAdmin } from '@/lib/supabaseAdmin';

const RATES_URL = 'https://open.er-api.com/v6/latest/USD';

/** Serve from memory for an hour; the upstream only refreshes daily anyway. */
const FRESH_TTL_MS = 60 * 60 * 1000;
/** How long a cached rate may still be served when the upstream is down. */
const STALE_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Last-resort approximations, used only when live and cached both fail. Deliberately round
 * numbers: they are not meant to look like precise quotes.
 */
const FALLBACK_RATES: Record<string, number> = {
  IDR: 16_000,
  PHP: 58,
  MYR: 4.4,
  SGD: 1.32,
  THB: 34,
  VND: 25_000,
};

export type RateSource = 'live' | 'stale' | 'fallback';

export interface FxRate {
  /** Units of `currency` per 1 USD. */
  rate: number;
  currency: string;
  source: RateSource;
  fetchedAt: string;
  /** The rate before this one, if Saku has seen a different value before. */
  previousRate?: number;
  /** Which way it moved. `flat` when there is nothing to compare against. */
  direction: 'up' | 'down' | 'flat';
  /** Signed percentage change from `previousRate`. */
  changePct: number;
  /** When the previous rate was observed. */
  previousAt?: string;
}

let cache: { rates: Record<string, number>; fetchedAt: number } | null = null;
/** Coalesces concurrent misses into one upstream request. */
let inFlight: Promise<Record<string, number> | null> | null = null;

async function fetchRates(): Promise<Record<string, number> | null> {
  if (inFlight) return inFlight;

  inFlight = (async () => {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 6000);

      const response = await fetch(RATES_URL, { signal: controller.signal });
      clearTimeout(timeout);

      if (!response.ok) return null;

      const body = await response.json();
      if (body?.result !== 'success' || !body?.rates) return null;

      cache = { rates: body.rates as Record<string, number>, fetchedAt: Date.now() };
      return cache.rates;
    } catch {
      return null;
    } finally {
      inFlight = null;
    }
  })();

  return inFlight;
}

/**
 * Compare against the last rate Saku recorded, and record this one if it moved.
 *
 * The history lives in the database rather than in memory: the upstream refreshes daily, so an
 * in-process "previous value" would almost always be empty — wiped by the last restart or cold
 * start before the rate ever changed. Failures here are swallowed, because a missing arrow is a
 * far smaller problem than a top up screen that will not load.
 */
async function withMovement(current: Omit<FxRate, 'direction' | 'changePct'>): Promise<FxRate> {
  try {
    const supabase = getSupabaseAdmin();

    const { data: last } = await supabase
      .from('fx_rates')
      .select('rate, observed_at')
      .eq('currency', current.currency)
      .order('observed_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    const previous = last ? Number(last.rate) : null;

    // Only a change is worth a row. Compared at the precision the column stores, so float noise
    // below that does not write history.
    const changed = previous === null || previous.toFixed(6) !== current.rate.toFixed(6);
    if (changed && current.source !== 'fallback') {
      await supabase.from('fx_rates').insert({
        currency: current.currency,
        rate: current.rate,
        source: current.source,
      });
    }

    if (previous === null || previous === current.rate) {
      return { ...current, direction: 'flat', changePct: 0 };
    }

    return {
      ...current,
      previousRate: previous,
      previousAt: last?.observed_at,
      direction: current.rate > previous ? 'up' : 'down',
      changePct: ((current.rate - previous) / previous) * 100,
    };
  } catch {
    return { ...current, direction: 'flat', changePct: 0 };
  }
}

/**
 * How many units of `currencyCode` one USD buys, and how that compares to last time.
 *
 * USDC is treated as 1 USD. It is a dollar-pegged stablecoin and, for a testnet demo priced in
 * whole dollars, tracking its market deviation would be precision theatre.
 */
export async function getUsdRate(currencyCode: string): Promise<FxRate> {
  const code = currencyCode.toUpperCase();
  const now = Date.now();

  const cachedIsFresh = cache && now - cache.fetchedAt < FRESH_TTL_MS;
  const rates = cachedIsFresh ? cache!.rates : await fetchRates();

  const live = rates?.[code];
  if (live && live > 0) {
    return withMovement({
      rate: live,
      currency: code,
      source: 'live',
      fetchedAt: new Date(cache?.fetchedAt ?? now).toISOString(),
    });
  }

  // Upstream failed. A rate from the last day is still far better than a constant.
  const stale = cache?.rates?.[code];
  if (stale && stale > 0 && now - (cache?.fetchedAt ?? 0) < STALE_TTL_MS) {
    return withMovement({
      rate: stale,
      currency: code,
      source: 'stale',
      fetchedAt: new Date(cache!.fetchedAt).toISOString(),
    });
  }

  return withMovement({
    rate: FALLBACK_RATES[code] ?? FALLBACK_RATES.IDR,
    currency: code,
    source: 'fallback',
    fetchedAt: new Date(now).toISOString(),
  });
}
