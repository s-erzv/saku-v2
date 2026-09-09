/**
 * What one USDC costs this user, right now, in their own currency.
 *
 * The top up screen needs a price to show while the user types, but the client is not allowed to
 * decide one — it renders this, and `/api/topup/create-payment` independently re-prices at
 * charge time from the same source. A stale tab therefore cannot lock in an old rate.
 */

import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { verifyToken, extractTokenFromHeader } from '@/lib/jwt';
import { chargeCurrencyFor, currencyForCountry } from '@/lib/currency';
import { getUsdRate } from '@/lib/fx';
import { chargesRealMoney } from '@/lib/xendit';
import { MAX_TOPUP_USDC, MIN_TOPUP_USDC } from '@/lib/topup';
import { getFeeConfig } from '@/lib/fees';

export async function GET(request: Request) {
  const sessionToken = extractTokenFromHeader(request.headers.get('authorization'));
  if (!sessionToken) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let session;
  try {
    session = await verifyToken(sessionToken);
  } catch {
    return NextResponse.json({ error: 'Invalid or expired session' }, { status: 401 });
  }

  try {
    const supabase = getSupabaseAdmin();
    const { data: user } = await supabase
      .from('users')
      .select('country_code')
      .eq('id', session.userId)
      .maybeSingle();

    // The currency the user reads, and the one the gateway can actually bill. They are the same
    // for an Indonesian account holder and differ for everyone else — see `lib/currency.ts`.
    const currency = currencyForCountry(user?.country_code);
    const chargeCurrency = chargeCurrencyFor(currency);
    const converted = chargeCurrency.code !== currency.code;

    const [fx, chargeFx] = await Promise.all([
      getUsdRate(currency.code),
      converted ? getUsdRate(chargeCurrency.code) : Promise.resolve(null),
    ]);

    // Whichever rate is least trustworthy decides the label. The displayed price and the money
    // actually taken both depend on a rate here, so calling the quote live because one of the
    // two happened to be live would overstate what Saku knows.
    const source =
      fx.source === 'fallback' || chargeFx?.source === 'fallback'
        ? 'fallback'
        : fx.source === 'stale' || chargeFx?.source === 'stale'
          ? 'stale'
          : fx.source;

    return NextResponse.json({
      currency: currency.code,
      symbol: currency.symbol,
      decimals: currency.decimals,
      locale: currency.locale,
      rate: fx.rate,
      // Present only when the two differ, so the screen can name the amount that will really
      // leave the user's account before they commit to it.
      converted,
      charge: converted
        ? {
            currency: chargeCurrency.code,
            symbol: chargeCurrency.symbol,
            decimals: chargeCurrency.decimals,
            locale: chargeCurrency.locale,
            rate: chargeFx!.rate,
          }
        : null,
      // 'fallback' means the rate is an approximation, and the UI says so rather than
      // presenting a guess as a quote.
      source,
      fetchedAt: fx.fetchedAt,
      // How the rate moved since Saku last saw it change.
      direction: fx.direction,
      changePct: fx.changePct,
      previousRate: fx.previousRate ?? null,
      previousAt: fx.previousAt ?? null,
      // Drives the real-money warning on the top up screen. False on a sandbox account, where
      // there is no charge to warn about.
      realPayment: chargesRealMoney(),
      minUsdc: MIN_TOPUP_USDC,
      maxUsdc: MAX_TOPUP_USDC,
      // Shown before the user confirms, never only on the receipt.
      feeBps: getFeeConfig().topupBps,
    });
  } catch {
    return NextResponse.json({ error: 'Could not load the exchange rate' }, { status: 500 });
  }
}
