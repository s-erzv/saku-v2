/**
 * Turns a stored notification row into the sentence a person reads.
 *
 * Formatted at *read* time, not at insert time. A notification says who did something, and a
 * name is not a fact about the past — someone who renames themselves would otherwise leave a
 * month of history addressing them by a name that no longer exists, which reads as a bug. So
 * the writers store structure (`metadata.amount`, `metadata.counterparty_user_id`, a title, a
 * rail) and this resolves it here, the same way `/api/transactions` resolves counterparty names
 * for history.
 *
 * `notifications.type` is a four-value Postgres enum shared by every feature, so it cannot be
 * the discriminator on its own — a packet claim and a wallet transfer are both `transfer_sent`.
 * This switches on `metadata`'s shape first, mirroring `app/notifications/page.tsx`'s
 * `iconFor()`, and only falls back to `type`.
 *
 * Every row keeps its stored `message` as a fallback, which is what rows written before this
 * existed (and any row missing an amount) still render.
 */

import { RAILS } from '@/lib/mock-fiat';

const USDC_DECIMALS = 6;

/** Someone whose name we cannot resolve is still a someone — never print a raw address here. */
export const UNKNOWN_PERSON = 'a Saku user';

export interface NotificationRowLike {
  type: string;
  message: string;
  metadata: Record<string, unknown> | null;
}

/**
 * Base units -> a human amount. Trailing zeros are dropped: "5 USDC" is how a person says it,
 * "5.00 USDC" is how a ledger does.
 */
function formatUsdc(raw: unknown): string | null {
  if (typeof raw !== 'string' && typeof raw !== 'number' && typeof raw !== 'bigint') return null;

  const digits = String(raw).replace(/[^0-9]/g, '');
  if (!digits) return null;

  const padded = digits.padStart(USDC_DECIMALS + 1, '0');
  const whole = Number(padded.slice(0, -USDC_DECIMALS));
  const fraction = padded.slice(-USDC_DECIMALS).replace(/0+$/, '').slice(0, 2);

  if (!Number.isFinite(whole)) return null;
  return fraction ? `${whole.toLocaleString('en-US')}.${fraction}` : whole.toLocaleString('en-US');
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/** The user id a row's sentence needs a name for, so a page of rows can batch one lookup. */
export function counterpartyIdOf(metadata: Record<string, unknown> | null): string | null {
  return text(metadata?.counterparty_user_id);
}

function railLabel(metadata: Record<string, unknown> | null): string | null {
  const rail = text(metadata?.rail);
  if (!rail) return null;
  return RAILS.find((r) => r.id === rail)?.label ?? null;
}

export function formatNotification(
  row: NotificationRowLike,
  resolveName: (userId: string | null) => string | null
): string {
  const meta = row.metadata ?? {};
  const amount = formatUsdc(meta.amount);
  const name = resolveName(counterpartyIdOf(row.metadata));
  const who = name ?? UNKNOWN_PERSON;

  // Packet claim — `transfer_sent` to the packet's creator.
  if ('packet_code' in meta) {
    if (!amount) return row.message;
    return name
      ? `${name} claimed ${amount} USDC from your packet`
      : `Someone claimed ${amount} USDC from your packet`;
  }

  // Split bill. Three shapes: a share settled through Saku (carries the transfer's hash), a
  // share the payer says they settled some other way, and being added to a bill (neither).
  if ('bill_id' in meta) {
    const title = text(meta.title);
    const bill = title ? `“${title}”` : 'your split bill';

    if (meta.payment_method === 'external') {
      const note = text(meta.note);
      const settled = amount
        ? `${who} marked their ${amount} USDC share of ${bill} as paid outside Saku`
        : `${who} marked their share of ${bill} as paid outside Saku`;
      return note ? `${settled} — “${note}”` : settled;
    }

    if ('tx_hash' in meta) {
      return amount
        ? `${who} paid their ${amount} USDC share of ${bill}`
        : `${who} paid their share of ${bill}`;
    }
    return amount
      ? `You were added to ${bill} — your share is ${amount} USDC`
      : `You were added to ${bill}`;
  }

  // QR payment request that someone paid.
  if ('code' in meta) {
    if (!amount) return row.message;
    return name ? `${name} paid your ${amount} USDC QR request` : `Your ${amount} USDC QR request was paid`;
  }

  // Off-ramp settlement. No Saku counterparty — the destination is a rail, so phrase it around that.
  if ('request_id' in meta) {
    const rail = railLabel(row.metadata);
    if (!amount) return rail ? `Your off-ramp to ${rail} is on its way` : row.message;
    return rail ? `Your ${amount} USDC is on its way to ${rail}` : `Your ${amount} USDC off-ramp is on its way`;
  }

  // Top up settled by the gateway.
  if ('order_id' in meta) {
    return amount ? `Top up complete — ${amount} USDC is now in your wallet` : row.message;
  }

  if (row.type === 'transfer_received') {
    if (!amount) return row.message;
    return name ? `You received ${amount} USDC from ${name}` : `You received ${amount} USDC`;
  }

  if (row.type === 'transfer_sent') {
    if (!amount) return row.message;
    return name ? `Your ${amount} USDC transfer to ${name} is on its way` : `Your ${amount} USDC transfer is on its way`;
  }

  return row.message;
}
