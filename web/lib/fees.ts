/**
 * Platform fees.
 *
 * Where Saku makes money, and — just as importantly — where it deliberately does not.
 *
 *  - **Top up** carries a fee because it is the on-ramp: the user is buying tokens and the
 *    payment gateway charges Saku for collecting the money. Passing that through plus a margin
 *    is the standard shape.
 *  - **Off-ramp / cross-rail** carries the larger fee. It is the product's actual value — money
 *    leaving the chain and arriving on a rail the recipient already uses — and it is where every
 *    real remittance product charges.
 *  - **Saku-to-Saku transfers are free**, on purpose. They are the growth loop: charging users
 *    to pay each other is how a wallet stops being used for the thing it is for. The gas is
 *    already sponsored, and that cost is far smaller than the acquisition it buys.
 *  - **QR payments are free to the payer.** In a real deployment the merchant pays an MDR; a
 *    payer-side fee on a coffee is what makes people stop scanning.
 *
 * Every rate is configurable, and every fee is shown to the user *before* they confirm. A fee
 * that only appears in the receipt is a fee designed not to be noticed.
 */

/** Basis points: 100 bps = 1%. */
export interface FeeConfig {
  topupBps: number;
  offrampBps: number;
  /** Never charge more than this in USDC terms, so a large transfer is not punished. */
  offrampCapUsdc: number;
  /** Floor in USDC, so a tiny transfer still covers its own settlement gas. */
  offrampMinUsdc: number;
}

function readBps(name: string, fallback: number): number {
  const raw = Number(process.env[name]);
  // A misconfigured fee should not silently become 0% (free) or 100% (theft).
  if (!Number.isFinite(raw) || raw < 0 || raw > 1_000) return fallback;
  return raw;
}

export function getFeeConfig(): FeeConfig {
  return {
    // 0.7% — roughly a payment gateway's own cut plus a thin margin.
    topupBps: readBps('NEXT_PUBLIC_FEE_TOPUP_BPS', 70),
    // 1.5% — the cross-rail leg, comparable to remittance pricing and well under card rates.
    offrampBps: readBps('NEXT_PUBLIC_FEE_OFFRAMP_BPS', 150),
    offrampCapUsdc: 25,
    offrampMinUsdc: 0.1,
  };
}

export interface FeeBreakdown {
  /** What the user asked for. */
  grossUsdc: number;
  feeUsdc: number;
  /** What actually moves after the fee. */
  netUsdc: number;
  bps: number;
}

/**
 * Top up: the fee is added on top.
 *
 * The user asked for N USDC and receives exactly N; the fee is added to what they pay, so the
 * number they picked is the number that lands in their wallet. Deducting it from the tokens
 * instead would mean asking for 10 and getting 9.93, which reads as a bug.
 */
export function topupFee(amountUsdc: number): FeeBreakdown {
  const { topupBps } = getFeeConfig();
  const fee = round6((amountUsdc * topupBps) / 10_000);

  return { grossUsdc: amountUsdc, feeUsdc: fee, netUsdc: amountUsdc, bps: topupBps };
}

/** What the user is charged in fiat terms for a top up: the tokens plus the fee. */
export function topupChargeableUsdc(amountUsdc: number): number {
  return round6(amountUsdc + topupFee(amountUsdc).feeUsdc);
}

/**
 * Off-ramp: the fee comes out of the amount.
 *
 * The user locks N USDC and the recipient is paid from N minus the fee. Taking it from the
 * locked amount keeps the on-chain and the fiat sides consistent — the escrow only ever knows
 * about one number.
 */
export function offrampFee(amountUsdc: number): FeeBreakdown {
  const { offrampBps, offrampCapUsdc, offrampMinUsdc } = getFeeConfig();

  let fee = (amountUsdc * offrampBps) / 10_000;
  if (fee > offrampCapUsdc) fee = offrampCapUsdc;
  if (fee < offrampMinUsdc) fee = offrampMinUsdc;
  // Never let the fee consume the transfer.
  if (fee >= amountUsdc) fee = round6(amountUsdc * 0.5);

  fee = round6(fee);

  return { grossUsdc: amountUsdc, feeUsdc: fee, netUsdc: round6(amountUsdc - fee), bps: offrampBps };
}

/** USDC has 6 decimals; anything finer cannot be represented on-chain. */
function round6(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}
