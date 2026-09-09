/**
 * The single description of what a receipt says.
 *
 * A receipt has two independent renderers here — the on-screen modal (JSX) and the shareable PNG
 * (a hand-written canvas draw, see `lib/receipt-image.ts`). They cannot share markup, so they
 * share this instead: the same title, the same rows, in the same order. Before this existed the
 * two drifted, and a row added to the modal quietly went missing from the image someone shared.
 */

import type { SakuTransaction } from '@/hooks/useTransactions';

export const USDC_DECIMALS = 6;

/** Paper stock. Warm off-white rather than the app's flat #FFF, so the receipt reads as a thing. */
export const PAPER = {
  top: '#FFFCF5',
  bottom: '#F7F1E4',
  ink: '#141210',
  muted: 'rgba(20,18,16,0.42)',
  hairline: 'rgba(20,18,16,0.16)',
  accent: '#F0A353',
  emerald: '#059669',
  red: '#DC2626',
} as const;

/** Height of one perforation tooth, shared by the CSS mask and the canvas sawtooth. */
export const TOOTH = { width: 16, height: 9 } as const;

/**
 * What to call this transaction.
 *
 * `context` first, then `type`. Three different things — funding a packet, opening one, paying a
 * split-bill share — all land in the database as `type: 'transfer'`, because on-chain that is
 * exactly what they are. Reading a history of them all labelled "Transfer" tells you nothing
 * about your own week, so the intent recorded alongside the row is what gets shown.
 */
export function describeTransaction(tx: SakuTransaction): { label: string; detail: string | null } {
  const context = tx.context;

  if (context?.kind === 'packet_send') {
    return {
      label: 'Packet sent',
      detail: context.slots ? `${context.slots} ${context.slots === 1 ? 'slot' : 'slots'}` : null,
    };
  }

  if (context?.kind === 'packet_claim') {
    return { label: 'Packet opened', detail: context.code ?? null };
  }

  if (context?.kind === 'split_bill') {
    return { label: 'Split bill', detail: context.title ?? null };
  }

  return { label: TYPE_LABEL[tx.type], detail: null };
}

export const TYPE_LABEL: Record<SakuTransaction['type'], string> = {
  transfer: 'Transfer',
  topup: 'Top Up',
  withdraw: 'Withdraw',
  qr_payment: 'QR Pay',
  offramp_lock: 'Sent to e-wallet',
  offramp_settle: 'Off-ramp settled',
  offramp_refund: 'Off-ramp refunded',
};

export const STATUS_LABEL: Record<SakuTransaction['status'], string> = {
  confirmed: 'Confirmed',
  pending: 'Pending',
  reverted: 'Reverted',
};

export function shorten(value: string, head = 8, tail = 6) {
  if (value.length <= head + tail + 1) return value;
  return `${value.slice(0, head)}…${value.slice(-tail)}`;
}

export function formatAmount(amount: string | number | null) {
  if (amount === null || amount === undefined || amount === '') return '0.00';
  try {
    // Split the base-unit string by position rather than dividing: `Number(amount)` loses
    // precision above 2^53, and pulling ethers in to move a decimal point is a lot of chain
    // library for a module the canvas draw also imports.
    //
    // `String(...)` rather than trusting the declared type: `amount` reaches this from a
    // Postgres `numeric`, and PostgREST serialises those as JSON numbers. Calling `.replace` on
    // one threw, was swallowed by the catch below, and printed every receipt as 0.00.
    const digits = String(amount).replace(/[^0-9]/g, '');
    if (!digits) return '0.00';

    const padded = digits.padStart(USDC_DECIMALS + 1, '0');
    let whole = Number(padded.slice(0, -USDC_DECIMALS));
    const fraction = padded.slice(-USDC_DECIMALS);
    let cents = Number(fraction.slice(0, 2));

    // Round rather than truncate — 1.999999 USDC reading as "1.99" understates what moved.
    if (Number(fraction[2]) >= 5) {
      cents += 1;
      if (cents === 100) {
        cents = 0;
        whole += 1;
      }
    }

    return `${whole.toLocaleString('en-US')}.${String(cents).padStart(2, '0')}`;
  } catch {
    return '0.00';
  }
}

/** Sum two base-unit strings and format the result, without going through a float. */
function addAmounts(a: string | number | null, b: string | number | null): string {
  const digits = (v: string | number | null) => String(v ?? '0').replace(/[^0-9]/g, '') || '0';
  return formatAmount((BigInt(digits(a)) + BigInt(digits(b))).toString());
}

export interface ReceiptRow {
  label: string;
  value: string;
  /** Hashes and addresses get the monospace treatment; names and dates do not. */
  mono?: boolean;
}

export interface ReceiptContent {
  incoming: boolean;
  typeLabel: string;
  statusLabel: string;
  statusColor: string;
  amount: string;
  /**
   * Platform fee, added on top — so `total` is `amount + fee`, and the counterparty received
   * `amount`. Null when the transaction carried no fee, or predates fees being recorded.
   */
  fee: string | null;
  /** What actually left the sender: amount plus fee. Equals `amount` when there is no fee. */
  total: string;
  rows: ReceiptRow[];
  /** Deterministic bar widths, so the same transaction always prints the same barcode. */
  barcode: number[];
  reference: string;
}

/**
 * Who — or what — is on the other end of this transaction.
 *
 * A top up has no human counterparty (the money comes from a payment gateway), so printing
 * "From 0x12…ef" on it implies a person who does not exist. Off-ramp's other end is a phone
 * number or a bank account off Saku entirely, which no address describes either.
 */
function counterpartyRow(tx: SakuTransaction): ReceiptRow | null {
  // A packet's other end is Saku's treasury, holding the money until someone opens it. Printing
  // its address would name a contract, not a person, and imply one had sent it to you.
  if (tx.context?.kind === 'packet_send') {
    return { label: 'Held by', value: 'Saku, until claimed' };
  }

  if (tx.context?.kind === 'packet_claim') {
    return { label: 'From', value: tx.counterpartyName ? `${tx.counterpartyName}'s packet` : 'A Saku packet' };
  }

  if (tx.context?.kind === 'split_bill') {
    const label = tx.direction === 'in' ? 'From' : 'To';
    return { label, value: tx.counterpartyName ?? 'Split bill' };
  }

  if (tx.type === 'topup') {
    // Xendit is the only gateway wired up (`lib/xendit.ts`); the specific channel the user paid
    // with lives on `topup_requests.payment_method` and never reaches a transaction row, so
    // naming the gateway is as precise as this surface can honestly be.
    return { label: 'Via', value: 'Xendit' };
  }

  if (tx.type === 'offramp_lock' || tx.type === 'offramp_settle' || tx.type === 'offramp_refund') {
    return { label: 'To', value: 'E-wallet or bank' };
  }

  const incoming = tx.direction === 'in';
  const label = incoming ? 'From' : 'To';

  if (tx.counterpartyName) return { label, value: tx.counterpartyName };

  // A Saku user who has not set a display name is still a person. Printing their wallet address
  // where a name belongs asks the reader to recognise a hex string as someone they know, which
  // nobody can do — and the address is already on the receipt, on the Ref row that opens
  // BscScan. Only a transfer with no Saku user behind it falls through to an address, because
  // there the address genuinely is the whole answer.
  if (tx.counterpartyIsUser) return { label, value: 'A Saku user' };

  const address = incoming ? tx.fromAddress : tx.toAddress;
  return address ? { label, value: shorten(address), mono: true } : null;
}

/** Six bars per hash nibble, widths 1–4 — enough to look printed, not enough to claim it scans. */
function barcodeFrom(txHash: string): number[] {
  const hex = txHash.replace(/^0x/, '');
  const bars: number[] = [];
  for (let i = 0; i < 44 && i < hex.length; i += 1) {
    bars.push((parseInt(hex[i], 16) % 4) + 1);
  }
  return bars;
}

export function buildReceipt(tx: SakuTransaction): ReceiptContent {
  const described = describeTransaction(tx);

  const rows: ReceiptRow[] = [
    {
      label: 'Date',
      value: new Date(tx.occurredAt).toLocaleString('en-US', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      }),
    },
  ];

  const counterparty = counterpartyRow(tx);
  if (counterparty) rows.push(counterparty);

  rows.push({ label: 'Ref', value: shorten(tx.txHash), mono: true });
  rows.push({ label: 'Network', value: 'BSC Testnet' });

  if (described.detail) {
    rows.push({
      label: tx.context?.kind === 'split_bill' ? 'Bill' : 'Packet',
      value: described.detail,
    });
  }

  // Only the side that paid it sees the fee. A recipient is told what arrived, and telling them
  // about a fee they did not pay would just be confusing.
  const fee = tx.direction === 'out' && tx.feeAmount && Number(tx.feeAmount) > 0
    ? formatAmount(tx.feeAmount)
    : null;

  return {
    incoming: tx.direction === 'in',
    typeLabel: described.label,
    fee,
    total: fee ? addAmounts(tx.amount, tx.feeAmount) : formatAmount(tx.amount),
    statusLabel: STATUS_LABEL[tx.status],
    statusColor:
      tx.status === 'confirmed' ? PAPER.emerald : tx.status === 'pending' ? PAPER.accent : PAPER.red,
    amount: formatAmount(tx.amount),
    rows,
    barcode: barcodeFrom(tx.txHash),
    reference: tx.txHash,
  };
}
