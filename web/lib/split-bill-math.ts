/**
 * Turning a receipt into what each person owes.
 *
 * A split bill used to be one number divided by a headcount, which is only correct when everyone
 * ordered the same thing. This works the way people actually settle up: each line item is
 * assigned to whoever ate it, tax and service are shared in proportion to what that came to, and
 * a discount is shared the same way.
 *
 * Kept as a pure module — no React, no fetch — because it is the part that has to be *right*.
 * Every figure here is in the receipt's own currency (rupiah on an Indonesian receipt); the
 * conversion to USDC happens once, at the edge, in whatever calls this.
 */

export interface BillItem {
  id: string;
  name: string;
  /** Unit price, in the receipt's currency. */
  price: number;
  qty: number;
  /** Participant ids who shared this line. Empty means "nobody said" — see `unassigned`. */
  assignedTo: string[];
}

export interface BillCharges {
  /** PPN, VAT — whatever the receipt adds on top. */
  tax: number;
  /** Service charge, kept separate from tax because a receipt lists them separately. */
  service: number;
  /** Positive number; subtracted. */
  discount: number;
}

export const EMPTY_CHARGES: BillCharges = { tax: 0, service: 0, discount: 0 };

export interface PersonItemShare {
  name: string;
  qty: number;
  /** This person's slice of the line, in the receipt's currency. */
  amount: number;
}

export interface PersonTotal {
  participantId: string;
  items: PersonItemShare[];
  subtotal: number;
  tax: number;
  service: number;
  discount: number;
  /** subtotal + tax + service − discount. */
  total: number;
}

export interface SplitResult {
  perPerson: PersonTotal[];
  /** Sum of every line item before charges. */
  subtotal: number;
  /** What the receipt should come to. */
  total: number;
  /** Lines nobody was assigned to — shared by everyone, and worth telling the user about. */
  unassigned: BillItem[];
}

export function itemTotal(item: BillItem): number {
  return round2(item.price * Math.max(1, item.qty));
}

/** Money, to two places. Enough for rupiah (whole units) and for a two-decimal currency alike. */
function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/**
 * Hand out `amount` in proportion to `weights`, with the rounding remainder going to the largest
 * weight. Proportional allocation that doesn't do this leaves the shares a cent short of the
 * total, which on a bill people are actually settling is the kind of thing that gets noticed.
 */
function allocate(amount: number, weights: number[]): number[] {
  if (amount === 0 || weights.length === 0) return weights.map(() => 0);

  const weightSum = weights.reduce((sum, w) => sum + w, 0);
  // Nothing to weigh by (every subtotal zero) — fall back to an even split.
  const basis = weightSum > 0 ? weights : weights.map(() => 1);
  const basisSum = basis.reduce((sum, w) => sum + w, 0);

  const shares = basis.map((w) => round2((amount * w) / basisSum));
  const drift = round2(amount - shares.reduce((sum, s) => sum + s, 0));

  if (drift !== 0) {
    let largest = 0;
    for (let i = 1; i < basis.length; i += 1) if (basis[i] > basis[largest]) largest = i;
    shares[largest] = round2(shares[largest] + drift);
  }

  return shares;
}

export function splitBill(
  items: BillItem[],
  charges: BillCharges,
  participantIds: string[]
): SplitResult {
  const perPerson: PersonTotal[] = participantIds.map((participantId) => ({
    participantId,
    items: [],
    subtotal: 0,
    tax: 0,
    service: 0,
    discount: 0,
    total: 0,
  }));

  const indexById = new Map(participantIds.map((id, index) => [id, index]));
  const unassigned: BillItem[] = [];

  for (const item of items) {
    // An unassigned line still has to be paid by somebody. Splitting it across everyone is the
    // least surprising default, and the caller surfaces which lines those were.
    const sharers = item.assignedTo.filter((id) => indexById.has(id));
    const targets = sharers.length > 0 ? sharers : participantIds;
    if (sharers.length === 0) unassigned.push(item);
    if (targets.length === 0) continue;

    const slices = allocate(itemTotal(item), targets.map(() => 1));

    targets.forEach((id, i) => {
      const person = perPerson[indexById.get(id)!];
      person.items.push({ name: item.name, qty: item.qty, amount: slices[i] });
      person.subtotal = round2(person.subtotal + slices[i]);
    });
  }

  const subtotals = perPerson.map((p) => p.subtotal);
  const taxShares = allocate(charges.tax, subtotals);
  const serviceShares = allocate(charges.service, subtotals);
  const discountShares = allocate(charges.discount, subtotals);

  perPerson.forEach((person, i) => {
    person.tax = taxShares[i];
    person.service = serviceShares[i];
    person.discount = discountShares[i];
    person.total = round2(person.subtotal + person.tax + person.service - person.discount);
  });

  const subtotal = round2(items.reduce((sum, item) => sum + itemTotal(item), 0));

  return {
    perPerson,
    subtotal,
    total: round2(subtotal + charges.tax + charges.service - charges.discount),
    unassigned,
  };
}

/** `35000` -> `Rp 35.000`. Falls back to a plain number when there is no currency to format in. */
export function formatMoney(
  amount: number,
  currency: { symbol: string; decimals: number; locale: string } | null
): string {
  if (!currency) {
    return amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  return `${currency.symbol}${amount.toLocaleString(currency.locale, {
    minimumFractionDigits: currency.decimals,
    maximumFractionDigits: currency.decimals,
  })}`;
}
