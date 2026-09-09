/**
 * Xendit Invoice client — the fiat-in leg of top up.
 *
 * The Invoice API is a hosted checkout: Saku creates an invoice, sends the user to
 * `invoice_url`, and Xendit handles every payment channel (VA, e-wallet, QRIS, retail) plus the
 * whole payment UI. No SDK ships to the browser and nothing about the payment is client-side,
 * which is one less thing that can be tampered with.
 *
 * Real money on this leg, testnet token on the other. That asymmetry is stated in the UI rather
 * than hidden.
 */

import crypto from 'crypto';

const API_BASE = 'https://api.xendit.co';

function getSecretKey(): string {
  const key = process.env.XENDIT_SECRET_KEY?.trim();
  if (!key) throw new Error('XENDIT_SECRET_KEY is not set — see env.example');
  return key;
}

/**
 * Whether this Xendit account actually takes money.
 *
 * Xendit issues `xnd_development_*` keys against a staging ledger — those invoices are play
 * money on a sandbox checkout, nothing leaves anyone's account. `xnd_production_*` keys are the
 * real thing. The distinction decides whether Saku owes the user a warning: charging real money
 * for a token that only exists on a testnet is a thing someone must be told before they pay,
 * and cluttering a sandbox demo with that same warning is just noise about a transaction that
 * is not happening.
 *
 * Fails closed. An unrecognised key shape is treated as real, because the cost of wrongly
 * staying quiet is far higher than the cost of a warning nobody needed.
 */
export function chargesRealMoney(): boolean {
  return !process.env.XENDIT_SECRET_KEY?.trim().startsWith('xnd_development_');
}

/** Xendit authenticates with HTTP Basic: secret key as username, empty password. */
function authHeader(): string {
  return `Basic ${Buffer.from(`${getSecretKey()}:`).toString('base64')}`;
}

export interface XenditInvoice {
  id: string;
  external_id: string;
  status: 'PENDING' | 'PAID' | 'SETTLED' | 'EXPIRED';
  invoice_url: string;
  amount: number;
  paid_amount?: number;
  payment_method?: string;
  payment_channel?: string;
  paid_at?: string;
}

export interface CreateInvoiceParams {
  orderId: string;
  /** Already rounded to the currency's precision by the caller. */
  amount: number;
  /** ISO 4217. Xendit charges in the user's own currency (PRD Section 6). */
  currency: string;
  description: string;
  successRedirectUrl: string;
  failureRedirectUrl: string;
}

/**
 * Create a hosted invoice.
 *
 * `external_id` is Saku's own order id, which is what ties the invoice back to a row in
 * `topup_requests` — Xendit's own id is recorded but never used as the key, so a webhook for
 * an invoice Saku did not create resolves to nothing.
 */
export async function createInvoice(params: CreateInvoiceParams): Promise<XenditInvoice> {
  const response = await fetch(`${API_BASE}/v2/invoices`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: authHeader(),
    },
    body: JSON.stringify({
      external_id: params.orderId,
      amount: params.amount,
      currency: params.currency,
      description: params.description,
      // 1 hour. Long enough for a bank transfer, short enough that abandoned invoices do not
      // linger as settleable rows.
      invoice_duration: 3600,
      success_redirect_url: params.successRedirectUrl,
      failure_redirect_url: params.failureRedirectUrl,
    }),
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body?.message || `Xendit returned ${response.status}`);
  }

  return body as XenditInvoice;
}

/**
 * Look an invoice up by Saku's order id.
 *
 * This is what lets top up work without a publicly reachable webhook: on localhost Xendit
 * cannot call back, so the client polls and settlement runs from whichever path arrives first.
 */
export async function fetchInvoiceByOrderId(orderId: string): Promise<XenditInvoice | null> {
  const response = await fetch(
    `${API_BASE}/v2/invoices?external_id=${encodeURIComponent(orderId)}`,
    { headers: { Authorization: authHeader() } }
  );

  if (!response.ok) throw new Error(`Xendit invoice lookup returned ${response.status}`);

  const invoices = (await response.json()) as XenditInvoice[];
  return Array.isArray(invoices) && invoices.length > 0 ? invoices[0] : null;
}

/**
 * Verify a webhook came from Xendit.
 *
 * Xendit does not sign the body; it sends a shared secret in `x-callback-token`. That makes
 * this check the only thing between the webhook route and someone crediting themselves tokens
 * by POSTing a fake "PAID", so the comparison is constant-time and a missing token fails.
 */
export function verifyCallbackToken(received: string | null): boolean {
  const expected = process.env.XENDIT_WEBHOOK_TOKEN?.trim();
  if (!expected || !received) return false;

  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(received, 'utf8');
  if (a.length !== b.length) return false;

  // timingSafeEqual needs equal lengths, checked above.
  return crypto.timingSafeEqual(a, b);
}

/** Money actually received. `SETTLED` is Xendit's post-settlement state for a paid invoice. */
export function isPaidStatus(status: string): boolean {
  return status === 'PAID' || status === 'SETTLED';
}

/** Terminal failure — stop polling. */
export function isDeadStatus(status: string): boolean {
  return status === 'EXPIRED';
}
