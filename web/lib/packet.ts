/**
 * Packet share arithmetic.
 *
 * The rule that matters: the sum of all shares must equal the funded total, exactly. A packet is
 * real money already sitting in the treasury, so a rounding error is either a claimer who
 * cannot be paid or dust that nobody can retrieve.
 *
 * Both modes therefore compute from what is *left*, not from the original total, and the final
 * claim always takes the entire remainder.
 */

/** Unambiguous alphabet: no O/0, no I/1, so a code read aloud or off a screen survives. */
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function generatePacketCode(length = 8): string {
  let code = '';
  for (let i = 0; i < length; i += 1) {
    code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  }
  return code;
}

export type SplitMode = 'equal' | 'random';

export function isSplitMode(value: unknown): value is SplitMode {
  return value === 'equal' || value === 'random';
}

export const MAX_SLOTS = 100;

/**
 * What the next claim is worth.
 *
 * @param remaining      Base units still unclaimed.
 * @param remainingSlots Claims still available, including this one.
 * @param mode           Equal split, or a random share of what is left.
 */
export function nextShare(remaining: bigint, remainingSlots: number, mode: SplitMode): bigint {
  if (remainingSlots <= 1) return remaining;
  if (remaining <= BigInt(0)) return BigInt(0);

  const slots = BigInt(remainingSlots);

  if (mode === 'equal') {
    // Integer division leaves a remainder of at most `remainingSlots - 1` base units, which the
    // final claim absorbs. With 6-decimal USDC that is sub-cent dust, never a lost share.
    return remaining / slots;
  }

  // "Double average" — the standard red-envelope distribution. Bounded below by 1 base unit so
  // no claimer can draw zero, and above by twice the fair share so one claim cannot strand the
  // rest with nothing.
  const average = remaining / slots;
  const max = average * BigInt(2);
  const span = max > BigInt(0) ? max : BigInt(1);

  const random = BigInt(Math.floor(Math.random() * Number(span > BigInt(1) ? span : BigInt(1))));
  const share = random > BigInt(0) ? random : BigInt(1);

  // Never take so much that a remaining claimer could get nothing.
  const reserve = BigInt(remainingSlots - 1);
  const spendable = remaining - reserve;

  return share < spendable ? share : spendable > BigInt(0) ? spendable : BigInt(1);
}

/**
 * A USDC figure for display, from the decimal string the API returns.
 *
 * `formatUnits` preserves every one of USDC's six decimals, so a random share prints as
 * "40.923833" next to a round one printing as "12.75". Money on a screen should line up.
 */
export function formatPacketAmount(value: string | null | undefined): string {
  const n = Number(value)
  return Number.isFinite(n) ? n.toFixed(2) : '0.00'
}
