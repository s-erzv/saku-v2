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
import { currencyForCountry } from '@/lib/currency';
import { getUsdRate } from '@/lib/fx';
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

    const currency = currencyForCountry(user?.country_code);
    const fx = await getUsdRate(currency.code);

    return NextResponse.json({
      currency: currency.code,
      symbol: currency.symbol,
      decimals: currency.decimals,
      locale: currency.locale,
      rate: fx.rate,
      // 'fallback' means the rate is an approximation, and the UI says so rather than
      // presenting a guess as a quote.
      source: fx.source,
      fetchedAt: fx.fetchedAt,
      // How the rate moved since Saku last saw it change.
      direction: fx.direction,
      changePct: fx.changePct,
      previousRate: fx.previousRate ?? null,
      previousAt: fx.previousAt ?? null,
      minUsdc: MIN_TOPUP_USDC,
      maxUsdc: MAX_TOPUP_USDC,
      // Shown before the user confirms, never only on the receipt.
      feeBps: getFeeConfig().topupBps,
    });
  } catch {
    return NextResponse.json({ error: 'Could not load the exchange rate' }, { status: 500 });
  }
}
