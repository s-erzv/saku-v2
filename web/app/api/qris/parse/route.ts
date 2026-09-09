/**
 * Read a scanned QRIS merchant code and price it.
 *
 * Parsing is genuinely real: QRIS is EMVCo's open merchant-QR format, so the merchant name,
 * NMID, acquirer and amount all come off the actual code the merchant printed. The CRC is
 * checked, and a code that fails it is rejected rather than shown as a merchant.
 *
 * Paying it is where the honesty has to hold. Settling into a merchant's QRIS account requires
 * being a licensed acquirer or issuer, which Saku is not (PRD Section 2.1). So a QRIS payment
 * runs down the same path as any other cross-rail transfer: the on-chain lock and swap are
 * real, and the leg that would credit the merchant is simulated and labelled.
 */

import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { getSession, unauthorized } from '@/lib/session';
import { parseQris } from '@/lib/qris';
import { currencyForCountry } from '@/lib/currency';
import { getUsdRate } from '@/lib/fx';
import { offrampFee } from '@/lib/fees';

export async function POST(request: Request) {
  const session = await getSession(request);
  if (!session) return unauthorized();

  try {
    const body = await request.json();
    const payload = typeof body.payload === 'string' ? body.payload : '';

    const qris = parseQris(payload);
    if (!qris) {
      return NextResponse.json({ error: 'That is not a QRIS code' }, { status: 400 });
    }
    if (!qris.crcValid) {
      // A failed checksum means the scan is corrupt or the code was altered. Either way it is
      // not something to render as a merchant and take money for.
      return NextResponse.json({ error: 'This QRIS code failed its checksum' }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();
    const { data: user } = await supabase
      .from('users')
      .select('country_code')
      .eq('id', session.userId)
      .maybeSingle();

    const currency = currencyForCountry(user?.country_code);
    const fx = await getUsdRate(currency.code);

    // A static code carries no amount — the payer enters it, as they would at the counter.
    let usdcNeeded: number | null = null;
    let feeUsdc: number | null = null;
    let netUsdc: number | null = null;

    if (qris.amount !== null) {
      // The merchant must receive the full amount; `offrampFee` adds its fee on top of that net
      // figure to get what the payer actually needs to lock.
      netUsdc = qris.amount / fx.rate;
      const fee = offrampFee(netUsdc);
      usdcNeeded = fee.grossUsdc;
      feeUsdc = fee.feeUsdc;
    }

    return NextResponse.json({
      merchant: {
        name: qris.merchantName,
        city: qris.merchantCity,
        id: qris.merchantId,
        acquirer: qris.acquirerDomain,
        categoryCode: qris.merchantCategoryCode,
      },
      amount: qris.amount,
      currency: qris.currency,
      dynamic: qris.dynamic,
      usdcNeeded,
      feeUsdc,
      netUsdc,
      fxRate: fx.rate,
      fxSource: fx.source,
      symbol: currency.symbol,
      locale: currency.locale,
      decimals: currency.decimals,
      // Stated in the payload so any client rendering this cannot present it as a settled rail.
      settlement: 'simulated',
      settlementNote:
        'The on-chain lock and swap are real. Crediting the merchant is simulated — Saku is not a licensed acquirer.',
    });
  } catch {
    return NextResponse.json({ error: 'Could not read that code' }, { status: 500 });
  }
}
