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
 *  - **Every on-chain movement the user signs** carries a small transfer fee: a plain transfer,
 *    a QR payment, paying a split-bill share, funding a packet. These were free by design until
 *    2026-09-09 — the argument was that charging users to pay each other stops a wallet being
 *    used for the thing it is for — and that call was reversed deliberately, not lost. The rate
 *    is set well below the on-ramp and off-ramp legs because these have no third-party cost
 *    behind them, only the gas Saku already sponsors.
 *  - **Staking is not charged.** Depositing is your own money moving into a contract you can
 *    withdraw it from, and a fee on the way in plus gas on the way out would be charging twice
 *    for one round trip.
 *  - **Nothing is charged where the user does not sign.** A top-up payout and a packet claim are
 *    paid by the treasury; the fee on those, where there is one, is on the leg the user chose.
 *
 * Every rate is configurable, and every fee is shown to the user *before* they confirm. A fee
 * that only appears in the receipt is a fee designed not to be noticed.
 */

/** Basis points: 100 bps = 1%. */
export interface FeeConfig {
  topupBps: number;
  offrampBps: number;
  /** Applies to every on-chain movement the user signs — see `transferFee`. */
  transferBps: number;
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
    // 0.3% — no third-party cost sits behind an internal transfer, only sponsored gas, so this
    // is deliberately a fraction of the on-ramp and off-ramp rates.
    transferBps: readBps('NEXT_PUBLIC_FEE_TRANSFER_BPS', 30),
    offrampCapUsdc: 25,
    offrampMinUsdc: 0.1,
  };
}

/**
 * Which of these is "what the user asked for" flips between the two functions below — see each
 * one's own doc comment. `grossUsdc` is always the larger of the two, `feeUsdc` is always the
 * difference between them.
 */
export interface FeeBreakdown {
  grossUsdc: number;
  feeUsdc: number;
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
 * Off-ramp: the fee is added on top, mirroring `topupFee`.
 *
 * `amountUsdc` here is the amount the recipient's conversion is based on — what the user asked
 * to have delivered — not the amount locked. The fee is added to get the amount actually locked
 * (`grossUsdc`), so the number the user typed is the number the recipient's payout is computed
 * from, not a reduced remainder after a fee comes out of it.
 *
 * The cap only matters above ~$1,667 of delivered amount at the default 1.5% rate, well past
 * `MAX_OFFRAMP_USDC` — so in practice only the floor ever binds, for small transfers.
 */
export function offrampFee(amountUsdc: number): FeeBreakdown {
  const { offrampBps, offrampCapUsdc, offrampMinUsdc } = getFeeConfig();

  let fee = (amountUsdc * offrampBps) / 10_000;
  if (fee > offrampCapUsdc) fee = offrampCapUsdc;
  if (fee < offrampMinUsdc) fee = offrampMinUsdc;

  fee = round6(fee);

  return { grossUsdc: round6(amountUsdc + fee), feeUsdc: fee, netUsdc: amountUsdc, bps: offrampBps };
}

/**
 * Every on-chain movement the user signs: transfer, QR payment, split-bill share, packet funding.
 *
 * Added on top, like every other fee here. `amountUsdc` is what the recipient receives — the
 * number the user typed — and `grossUsdc` is what leaves their wallet. Deducting instead would
 * mean sending 10 and having 9.97 arrive, which is the thing that reads as a bug.
 *
 * Collected as a second transfer to the treasury rather than by a contract that splits, so it is
 * visible on-chain as its own movement. See `lib/platform-fee.ts` for the ordering that keeps a
 * half-failure safe.
 */
export function transferFee(amountUsdc: number): FeeBreakdown {
  const { transferBps } = getFeeConfig();
  const fee = round6((amountUsdc * transferBps) / 10_000);

  return { grossUsdc: round6(amountUsdc + fee), feeUsdc: fee, netUsdc: amountUsdc, bps: transferBps };
}

/** USDC has 6 decimals; anything finer cannot be represented on-chain. */
function round6(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

/**
 * A USDC amount as the user should read it: never rounded down into a lie.
 *
 * `toFixed(2)` was used everywhere a fee appeared, and on the small amounts this app is built
 * for it erased the fee entirely — 0.30% of 1.50 USDC is 0.0045, which rendered as `+0.00 USDC`.
 * Worse than untidy: the three lines stopped adding up, because "You pay" was also being cut to
 * two decimals, so the screen showed 1.50 + 0.00 = 1.50 while 1.5045 actually left the wallet.
 *
 * Two decimals stay the floor, so ordinary amounts still read as money rather than as a long
 * decimal. Six is the ceiling because that is USDC's real precision — showing more would be
 * inventing digits the token cannot hold.
 */
export function formatUsdc(amountUsdc: number): string {
  if (!Number.isFinite(amountUsdc)) return '0.00';
  return amountUsdc.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 6,
  });
}
