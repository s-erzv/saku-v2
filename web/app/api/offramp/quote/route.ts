/**
 * What the recipient would receive for a given amount of USDC.
 *
 * Two rates stack here, and they come from different places on purpose:
 *
 *  - The on-chain leg (USDC -> stable token) is quoted from the actual PancakeSwap pool, so the
 *    number reflects real liquidity and real slippage rather than a mid-market ideal.
 *  - The fiat leg (stable -> local currency) uses the same FX source as top up, and is part of
 *    the *simulated* half of the flow (PRD Section 4).
 *
 * The response separates them so the UI can be honest about which half is real.
 */

import { NextResponse } from 'next/server';
import { formatUnits, parseUnits } from 'ethers';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { getSession, unauthorized } from '@/lib/session';
import { USDC_DECIMALS, getUsdcAddress } from '@/lib/chain';
import { quoteSwap, RATE_EXPIRY_SECONDS } from '@/lib/escrow';
import { currencyForCountry } from '@/lib/currency';
import { getUsdRate } from '@/lib/fx';
import { getFeeConfig, offrampFee } from '@/lib/fees';
import { getCompliancePolicy, isOfframpAllowed, offrampDisabledMessage } from '@/lib/compliance';

/** Stable token is 18-decimal (MockStableToken). */
const STABLE_DECIMALS = 18;

export const MIN_OFFRAMP_USDC = 1;
export const MAX_OFFRAMP_USDC = 1000;

export async function GET(request: Request) {
  const session = await getSession(request);
  if (!session) return unauthorized();

  try {
    const url = new URL(request.url);
    const amountUsdc = Number(url.searchParams.get('amountUsdc') ?? '0');

    const supabase = getSupabaseAdmin();
    const { data: user } = await supabase
      .from('users')
      .select('country_code')
      .eq('id', session.userId)
      .maybeSingle();

    const currency = currencyForCountry(user?.country_code);
    const fx = await getUsdRate(currency.code);

    // PRD Section 6: the off-ramp is a per-country policy decision, not a universal feature.
    // Checked before anything else — an amount-bearing request from a disabled country is
    // refused outright, and the amount-less "rate + limits" request still needs to carry this
    // so the UI can show why the form is blocked rather than a generic error later.
    const policy = await getCompliancePolicy(user?.country_code);
    const offrampEnabled = isOfframpAllowed(policy);

    if (!offrampEnabled && Number.isFinite(amountUsdc) && amountUsdc > 0) {
      return NextResponse.json(
        { error: offrampDisabledMessage(policy), offrampEnabled: false },
        { status: 403 }
      );
    }

    // Without an amount the caller only wants the rate and the limits.
    if (!Number.isFinite(amountUsdc) || amountUsdc < MIN_OFFRAMP_USDC || amountUsdc > MAX_OFFRAMP_USDC) {
      return NextResponse.json({
        offrampEnabled,
        offrampDisabledReason: offrampEnabled ? undefined : offrampDisabledMessage(policy),
        currency: currency.code,
        symbol: currency.symbol,
        decimals: currency.decimals,
        locale: currency.locale,
        fxRate: fx.rate,
        fxSource: fx.source,
        minUsdc: MIN_OFFRAMP_USDC,
        maxUsdc: MAX_OFFRAMP_USDC,
        rateExpirySeconds: RATE_EXPIRY_SECONDS,
        feeBps: getFeeConfig().offrampBps,
      });
    }

    // The fee is added on top (mirrors top up): `amountUsdc` is what the user wants delivered,
    // `fee.grossUsdc` is what actually has to be locked and swapped to cover that plus the fee.
    const fee = offrampFee(amountUsdc);
    const amountIn = parseUnits(fee.grossUsdc.toString(), USDC_DECIMALS);
    const { expectedOut, minAmountOut } = await quoteSwap(getUsdcAddress(), amountIn);

    const stableOut = Number(formatUnits(expectedOut, STABLE_DECIMALS));

    // Only the net (delivered) slice of the swap proceeds goes to the recipient — the rest is
    // the platform fee, realized by keeping that proportion of the swap output.
    const netRatio = fee.netUsdc / fee.grossUsdc;
    const fiatAmount = Math.round(stableOut * netRatio * fx.rate * 100) / 100;

    return NextResponse.json({
      amountUsdc,
      // What must actually be locked on-chain to deliver `amountUsdc` after the fee.
      grossUsdc: fee.grossUsdc,
      // Real: what the pool would actually return for locking `grossUsdc`.
      stableOut,
      minStableOut: Number(formatUnits(minAmountOut, STABLE_DECIMALS)),
      // Simulated: what the mock fiat leg would pay out.
      fiatAmount,
      feeUsdc: fee.feeUsdc,
      netUsdc: fee.netUsdc,
      feeBps: fee.bps,
      currency: currency.code,
      symbol: currency.symbol,
      decimals: currency.decimals,
      locale: currency.locale,
      fxRate: fx.rate,
      fxSource: fx.source,
      minUsdc: MIN_OFFRAMP_USDC,
      maxUsdc: MAX_OFFRAMP_USDC,
      rateExpirySeconds: RATE_EXPIRY_SECONDS,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not quote this transfer';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
