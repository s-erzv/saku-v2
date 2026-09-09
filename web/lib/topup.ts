/**
 * Topup settlement — the on-chain half of a gateway payment.
 *
 * Two callers reach this: the Xendit webhook (production) and the status poll the client runs
 * (localhost, where Xendit cannot call back). Both can arrive for the same order, possibly at
 * the same time, so `settleTopup` claims the row with a conditional UPDATE before it pays out.
 * The claim is what makes double-crediting impossible — not the caller being careful.
 *
 * The payout goes to the user's MPC wallet address, read from `wallets` at settlement time. The
 * client never gets to name the destination.
 */

import { parseUnits } from 'ethers';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { CHAIN_ID, USDC_DECIMALS, getSettler, getUsdcAddress, payoutUsdc } from '@/lib/chain';
import { chargeCurrencyFor, currencyForCountry, roundToCurrency, type CurrencyInfo } from '@/lib/currency';
import { getUsdRate, type RateSource } from '@/lib/fx';
import { topupChargeableUsdc, topupFee } from '@/lib/fees';

/**
 * USDC -> token base units.
 *
 * The user picks an amount of USDC, not an amount of local currency: what they are buying is
 * the token, and the fiat figure is its price. Pricing the other way round leaves them with odd
 * amounts like 6.25 USDC and no way to ask for a round number.
 */
export function usdcToTokenBaseUnits(amountUsdc: number): bigint {
  // Round to the token's precision before parsing; parseUnits rejects extra decimals.
  return parseUnits(amountUsdc.toFixed(USDC_DECIMALS), USDC_DECIMALS);
}

export interface TopupQuote {
  /** What lands in the wallet — the number the user picked, unreduced. */
  amountUsdc: number;
  /** Platform fee, in USDC terms, added on top rather than deducted from the tokens. */
  feeUsdc: number;

  /**
   * What the gateway is actually asked to charge, already rounded to that currency's real
   * precision. This is the money that moves, so it is what the database records and what
   * `createInvoice` is handed.
   */
  grossAmount: number;
  /** The fee expressed in the charged currency, for showing as a line item. */
  feeAmount: number;
  currency: CurrencyInfo;
  /** Units of `currency` per 1 USD. */
  fxRate: number;
  fxSource: RateSource;

  /**
   * The same price in the user's own currency. Equal to the charge fields whenever the gateway
   * account can bill that currency, which is the only case that exists for an Indonesian user.
   */
  displayAmount: number;
  displayFeeAmount: number;
  displayCurrency: CurrencyInfo;
  displayFxRate: number;
  /**
   * True when the two differ. The UI must say so before the user commits — someone in Malaysia
   * agreeing to a ringgit figure and then seeing rupiah leave their account has been misled,
   * even though the amount is right.
   */
  converted: boolean;
}

/**
 * Price an amount of USDC in the user's own currency, at the current rate.
 *
 * USDC is treated as 1 USD (see `lib/fx.ts`). The quote is always produced server-side: the
 * client renders it, but what is charged and what is credited are both derived here.
 *
 * Two currencies come out of this, not one. The user's own is what the screen leads with,
 * because a price in a currency you do not think in is not a price you can judge. The charge
 * currency is whatever the gateway account can actually present (see `lib/currency.ts`), and
 * both are derived from the same USD figure, so they never disagree about what was bought.
 */
export async function quoteTopup(amountUsdc: number, countryCode: string | null): Promise<TopupQuote> {
  const displayCurrency = currencyForCountry(countryCode);
  const currency = chargeCurrencyFor(displayCurrency);
  const converted = currency.code !== displayCurrency.code;

  const [charge, display] = await Promise.all([
    getUsdRate(currency.code),
    converted ? getUsdRate(displayCurrency.code) : Promise.resolve(null),
  ]);

  const displayRate = display?.rate ?? charge.rate;
  const fee = topupFee(amountUsdc).feeUsdc;
  const chargeable = topupChargeableUsdc(amountUsdc);

  return {
    amountUsdc,
    feeUsdc: fee,
    // Priced off tokens-plus-fee, so the user receives exactly the amount they asked for.
    grossAmount: roundToCurrency(chargeable * charge.rate, currency),
    feeAmount: roundToCurrency(fee * charge.rate, currency),
    currency,
    fxRate: charge.rate,
    // The charge rate's source is the one that matters: it is the number the money was derived
    // from, and the one the UI labels as approximate when no live rate was available.
    fxSource: charge.source,
    displayAmount: roundToCurrency(chargeable * displayRate, displayCurrency),
    displayFeeAmount: roundToCurrency(fee * displayRate, displayCurrency),
    displayCurrency,
    displayFxRate: displayRate,
    converted,
  };
}

export const MIN_TOPUP_USDC = 1;
export const MAX_TOPUP_USDC = 500;

export interface SettleResult {
  status: 'completed' | 'already_completed' | 'no_wallet' | 'payout_failed';
  txHash?: string;
  error?: string;
}

/**
 * Credit a paid topup on-chain, exactly once.
 *
 * @param orderId  The Saku-generated order id the gateway echoes back as `external_id`.
 * @param paidMeta What the payment provider reported, recorded before the payout is attempted
 *                 so a failed payout still leaves evidence the money arrived.
 */
export async function settleTopup(
  orderId: string,
  paidMeta: {
    invoiceId?: string;
    providerStatus?: string;
    paymentMethod?: string;
  } = {}
): Promise<SettleResult> {
  const supabase = getSupabaseAdmin();

  // Claim: only a row still awaiting settlement moves to `paid`. A concurrent caller that loses
  // this race updates zero rows and stops here, so only one payout is ever attempted.
  const { data: claimed, error: claimError } = await supabase
    .from('topup_requests')
    .update({
      status: 'paid',
      paid_at: new Date().toISOString(),
      provider_invoice_id: paidMeta.invoiceId ?? null,
      provider_status: paidMeta.providerStatus ?? null,
      ...(paidMeta.paymentMethod ? { payment_method: paidMeta.paymentMethod } : {}),
    })
    .eq('order_id', orderId)
    .in('status', ['pending', 'failed'])
    .select('id, user_id, token_amount')
    .maybeSingle();

  if (claimError) throw claimError;
  if (!claimed) {
    // Either already completed, or mid-settlement in another invocation. Both mean "not ours".
    return { status: 'already_completed' };
  }

  const { data: wallet } = await supabase
    .from('wallets')
    .select('address')
    .eq('user_id', claimed.user_id)
    .eq('chain_id', CHAIN_ID)
    .maybeSingle();

  if (!wallet?.address) {
    // The money arrived but there is nowhere to send the tokens. Leave the row at `paid`, not
    // `failed`: the user finishing MPC setup should let a retry complete it.
    await supabase
      .from('topup_requests')
      .update({ failure_reason: 'No wallet registered for this user yet' })
      .eq('id', claimed.id);
    return { status: 'no_wallet' };
  }

  try {
    const receipt = await payoutUsdc(wallet.address, BigInt(claimed.token_amount));

    await supabase
      .from('topup_requests')
      .update({
        status: 'completed',
        payout_tx_hash: receipt.hash.toLowerCase(),
        payout_to: wallet.address.toLowerCase(),
        completed_at: new Date().toISOString(),
        failure_reason: null,
      })
      .eq('id', claimed.id);

    // History and notification are best-effort: the chain already has the truth, and failing
    // the settlement because a cache write failed would be worse than a missing row.
    await supabase.from('transactions').insert({
      tx_hash: receipt.hash.toLowerCase(),
      chain_id: CHAIN_ID,
      type: 'topup',
      status: 'confirmed',
      from_address: getSettler().address.toLowerCase(),
      to_address: wallet.address.toLowerCase(),
      token_address: getUsdcAddress().toLowerCase(),
      amount: String(claimed.token_amount),
      user_id: claimed.user_id,
      block_number: receipt.blockNumber,
    });

    await supabase.from('notifications').insert({
      user_id: claimed.user_id,
      type: 'system',
      message: 'Top up complete — your balance has been updated.',
      metadata: {
        order_id: orderId,
        tx_hash: receipt.hash.toLowerCase(),
        amount: String(claimed.token_amount),
      },
    });

    return { status: 'completed', txHash: receipt.hash };
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'Payout failed';
    // Back to a claimable state so a retry (next poll, or a webhook redelivery) can finish it.
    await supabase
      .from('topup_requests')
      .update({ status: 'failed', failure_reason: reason.slice(0, 500) })
      .eq('id', claimed.id);

    return { status: 'payout_failed', error: reason };
  }
}
