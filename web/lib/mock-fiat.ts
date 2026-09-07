/**
 * The simulated half of the off-ramp — and it says so, everywhere it can.
 *
 * PRD Section 4 draws the line explicitly: anything buildable without a licence is built for
 * real (the escrow, the PancakeSwap swap, the Chainlink feed, MPC signing), and anything that
 * inherently requires a licensed entity — converting stable tokens to rupiah, disbursing into
 * someone's GoPay — is simulated and *declared* as simulated. Saku is a wallet interface, not a
 * PJP (PRD Section 2.1), and pretending otherwise in a demo is how a hackathon project turns
 * into a claim nobody can back.
 *
 * So these two functions move no money. They produce references that look like the real thing
 * because the flow needs something to record, and every one of them is prefixed `MOCK-` so it
 * can never be mistaken for a payment provider's receipt.
 */

export type Rail = 'gopay' | 'ovo' | 'dana' | 'shopeepay' | 'bank';

export const RAILS: { id: Rail; label: string }[] = [
  { id: 'gopay', label: 'GoPay' },
  { id: 'ovo', label: 'OVO' },
  { id: 'dana', label: 'DANA' },
  { id: 'shopeepay', label: 'ShopeePay' },
  { id: 'bank', label: 'Bank transfer' },
];

export function isRail(value: unknown): value is Rail {
  return typeof value === 'string' && RAILS.some((r) => r.id === value);
}

function reference(prefix: string): string {
  return `MOCK-${prefix}-${Date.now().toString(36).toUpperCase()}-${Math.random()
    .toString(36)
    .slice(2, 8)
    .toUpperCase()}`;
}

export interface MockExchangeResult {
  reference: string;
  /** Local-currency amount the stable tokens "converted" into. */
  fiatAmount: number;
  currency: string;
  simulated: true;
}

/**
 * [SIMULATED] Stable token -> local currency (PRD 5.1 step 7).
 *
 * A real implementation is an order on a licensed exchange. This one applies the same FX rate
 * the rest of Saku uses and returns a reference.
 */
export async function mockExchange(
  stableAmount: number,
  currency: string,
  fxRate: number
): Promise<MockExchangeResult> {
  return {
    reference: reference('FX'),
    // The stable token is dollar-pegged, so the conversion is the FX rate itself.
    fiatAmount: Math.round(stableAmount * fxRate * 100) / 100,
    currency,
    simulated: true,
  };
}

export interface MockDisbursementResult {
  reference: string;
  simulated: true;
}

/**
 * [SIMULATED] Pay local currency into the recipient's e-wallet (PRD 5.1 step 8).
 *
 * The recipient is identified by a phone *hash* even here. Nothing about this being a mock is a
 * reason to start handling plain numbers — the point of hashing them survives the simulation.
 */
export async function mockDisbursement(
  rail: Rail,
  recipientPhoneHash: string,
  fiatAmount: number,
  currency: string
): Promise<MockDisbursementResult> {
  void rail;
  void recipientPhoneHash;
  void fiatAmount;
  void currency;

  return { reference: reference('DISB'), simulated: true };
}
