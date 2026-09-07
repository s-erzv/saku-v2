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
import { verifyToken, extractTokenFromHeader } from '@/lib/jwt';
import { USDC_DECIMALS, getUsdcAddress } from '@/lib/chain';
import { quoteSwap, RATE_EXPIRY_SECONDS } from '@/lib/escrow';
import { currencyForCountry } from '@/lib/currency';
import { getUsdRate } from '@/lib/fx';
import { getFeeConfig, offrampFee } from '@/lib/fees';

/** Stable token is 18-decimal (MockStableToken). */
const STABLE_DECIMALS = 18;

export const MIN_OFFRAMP_USDC = 1;
export const MAX_OFFRAMP_USDC = 1000;

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

    // Without an amount the caller only wants the rate and the limits.
    if (!Number.isFinite(amountUsdc) || amountUsdc < MIN_OFFRAMP_USDC || amountUsdc > MAX_OFFRAMP_USDC) {
      return NextResponse.json({
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

    const amountIn = parseUnits(amountUsdc.toString(), USDC_DECIMALS);
    const { expectedOut, minAmountOut } = await quoteSwap(getUsdcAddress(), amountIn);

    const stableOut = Number(formatUnits(expectedOut, STABLE_DECIMALS));

    // The fee comes out of the amount, so the recipient is paid on the net. Taking it from the
    // locked amount keeps one number on-chain and one number in the payout.
    const fee = offrampFee(amountUsdc);
    const netRatio = fee.netUsdc / amountUsdc;
    const fiatAmount = Math.round(stableOut * netRatio * fx.rate * 100) / 100;

    return NextResponse.json({
      amountUsdc,
      // Real: what the pool would actually return.
      stableOut,
      minStableOut: Number(formatUnits(minAmountOut, STABLE_DECIMALS)),
      // Simulated: what the mock fiat leg would pay out, after the platform fee.
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
