/**
 * Telling a real payout from a simulated one, and saying so on a receipt.
 *
 * Saku holds no payment licence. Where an Indonesian e-wallet rail and a named partner allow it,
 * `lib/xendit-disbursement.ts` really does move rupiah through Xendit; everywhere else
 * `lib/mock-fiat.ts` stands in and moves nothing. A receipt has to be able to say which of those
 * happened, because the one thing a proof of transfer must never do is imply money arrived when
 * it did not.
 *
 * The test is the reference itself. `lib/mock-fiat.ts` prefixes every simulated reference with
 * `MOCK-` precisely so it "can never be mistaken for a payment provider's receipt" — that
 * invariant is the load-bearing part here, and it is why this needs no extra column recording
 * which path ran. A real Xendit disbursement id never carries that prefix.
 *
 * Unknown reads as simulated. Wrong in the cautious direction: a receipt that understates what
 * happened is a support question, and one that overstates it is a false claim about someone's
 * money.
 */

const MOCK_PREFIX = 'MOCK-';

export function isSimulatedPayout(reference: string | null | undefined): boolean {
  if (!reference) return true;
  return reference.startsWith(MOCK_PREFIX);
}

/** Who actually moved the money, for the line on the receipt that names them. */
export function payoutProvider(reference: string | null | undefined): string {
  return isSimulatedPayout(reference) ? 'Simulated — no funds moved' : 'Xendit';
}
