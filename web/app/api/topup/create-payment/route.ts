/**
 * Start a topup: price it, record it, and hand back a Xendit checkout URL.
 *
 * Nothing is credited here. The tokens only move after Xendit confirms payment, through either
 * the webhook or the status poll — both of which go through `settleTopup`.
 */

import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { getSession, unauthorized } from '@/lib/session';
import { createInvoice } from '@/lib/xendit';
import { getUsdcAddress } from '@/lib/chain';
import {
  MAX_TOPUP_USDC,
  MIN_TOPUP_USDC,
  quoteTopup,
  usdcToTokenBaseUnits,
} from '@/lib/topup';
import { checkRateLimit, RATE_LIMITS } from '@/lib/rate-limiter';
import { describeDbError } from '@/lib/db-errors';
import { clientKey } from '@/lib/request-meta';

/** `SAKU-<epoch>-<random>`: unique per attempt, and a reused external id would collide. */
function generateOrderId(): string {
  return `SAKU-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
}

export async function POST(request: Request) {
  const session = await getSession(request);
  if (!session) return unauthorized();

  if (!(await checkRateLimit(clientKey(request, 'topup'), RATE_LIMITS.IP_BASED)).allowed) {
    return NextResponse.json({ error: 'Too many requests. Try again shortly.' }, { status: 429 });
  }

  try {
    const body = await request.json();
    const amountUsdc = Number(body.amountUsdc);

    if (!Number.isFinite(amountUsdc) || amountUsdc < MIN_TOPUP_USDC || amountUsdc > MAX_TOPUP_USDC) {
      return NextResponse.json(
        { error: `Amount must be between ${MIN_TOPUP_USDC} and ${MAX_TOPUP_USDC} USDC` },
        { status: 400 }
      );
    }

    // Priced server-side, at the rate that is current now — not the one the client was showing.
    // The user's country decides the currency (PRD Section 6); it is read from their record,
    // never from the request.
    const supabase = getSupabaseAdmin();
    const { data: user } = await supabase
      .from('users')
      .select('country_code')
      .eq('id', session.userId)
      .maybeSingle();

    const quote = await quoteTopup(amountUsdc, user?.country_code ?? null);
    const tokenAmount = usdcToTokenBaseUnits(amountUsdc);
    if (tokenAmount <= BigInt(0)) {
      return NextResponse.json({ error: 'Amount is too small' }, { status: 400 });
    }

    const orderId = generateOrderId();

    // Recorded before the invoice exists: if invoice creation fails, the row stays `pending`
    // with no payment attached and simply never settles — the safe direction to fail in.
    const { error: insertError } = await supabase.from('topup_requests').insert({
      order_id: orderId,
      user_id: session.userId,
      gross_amount: quote.grossAmount,
      currency: quote.currency.code,
      token_amount: tokenAmount.toString(),
      fx_rate: quote.fxRate,
      fx_source: quote.fxSource,
      token_address: getUsdcAddress().toLowerCase(),
    });

    if (insertError) throw insertError;

    const origin = new URL(request.url).origin;
    const invoice = await createInvoice({
      orderId,
      amount: quote.grossAmount,
      currency: quote.currency.code,
      description: `Saku Top Up — ${amountUsdc} USDC`,
      successRedirectUrl: `${origin}/topup/callback/${orderId}`,
      failureRedirectUrl: `${origin}/topup/callback/${orderId}`,
    });

    await supabase
      .from('topup_requests')
      .update({
        checkout_url: invoice.invoice_url,
        provider_invoice_id: invoice.id,
        provider_status: invoice.status,
      })
      .eq('order_id', orderId);

    return NextResponse.json({
      success: true,
      orderId,
      checkoutUrl: invoice.invoice_url,
      amountUsdc,
      feeUsdc: quote.feeUsdc,
      grossAmount: quote.grossAmount,
      feeAmount: quote.feeAmount,
      currency: quote.currency.code,
      fxRate: quote.fxRate,
      fxSource: quote.fxSource,
    });
  } catch (error) {
    // Gateway misconfiguration and schema drift are the two common causes here, and both are
    // the operator's to fix — so the real reason is surfaced instead of a bare 500. Nothing in
    // these messages describes user data.
    const { message, isSchemaDrift, code } = describeDbError(error, 'Could not start the payment');
    console.error('[topup/create-payment]', code ?? '', message);
    return NextResponse.json({ error: message, schemaOutOfDate: isSchemaDrift || undefined }, { status: 500 });
  }
}
