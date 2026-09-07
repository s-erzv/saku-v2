/**
 * Real e-wallet disbursement via Xendit.
 *
 * This is the leg that was simulated (`lib/mock-fiat.ts`) because Payouts V3 — Xendit's
 * cross-border product — asks for the recipient's legal name and address, which Saku's identity
 * model never collects (phone hash only, by design). The legacy Indonesia `/disbursements`
 * endpoint does not: `bank_code: "GOPAY"|"OVO"|"DANA"|"SHOPEEPAY"|"LINKAJA"` with a phone number
 * as the account number is enough. That is the one gap where "phone number only" and "a real
 * payout API" turn out to be compatible, and it only exists for Indonesian e-wallets — this is
 * not a general substitute for Payouts V3.
 *
 * What is still true regardless of which API sends it: Saku holds no payment licence itself.
 * Xendit is the licensed party actually moving the rupiah; this file only calls their API.
 */

const API_BASE = 'https://api.xendit.co';

/** Exactly what `/available_disbursements_banks` reports as `can_disburse: true` for wallets. */
const WALLET_CHANNEL_MAP: Record<string, string> = {
  gopay: 'GOPAY',
  ovo: 'OVO',
  dana: 'DANA',
  shopeepay: 'SHOPEEPAY',
};

/** `bank` in `lib/mock-fiat.ts`'s `Rail` type has no real disbursement channel — it stays simulated. */
export function disbursementChannelFor(rail: string): string | null {
  return WALLET_CHANNEL_MAP[rail] ?? null;
}

function getSecretKey(): string {
  const key = process.env.XENDIT_SECRET_KEY?.trim();
  if (!key) throw new Error('XENDIT_SECRET_KEY is not set');
  return key;
}

function authHeader(): string {
  return `Basic ${Buffer.from(`${getSecretKey()}:`).toString('base64')}`;
}

export interface DisbursementResult {
  id: string;
  status: 'PENDING' | 'COMPLETED' | 'FAILED';
  externalId: string;
}

/**
 * Send IDR to a phone number's e-wallet.
 *
 * @param amountIdr  Whole rupiah — the legacy API takes a plain integer, not minor units.
 * @param phone      E.164 digits, no `+`. Sent as both `account_number` and (since a wallet has
 *                   no separate account name) `account_holder_name` — the phone number is the
 *                   only identifier a GoPay/OVO/DANA/ShopeePay disbursement needs.
 */
export async function sendWalletDisbursement(
  externalId: string,
  rail: string,
  phone: string,
  amountIdr: number,
  description: string
): Promise<DisbursementResult> {
  const channel = disbursementChannelFor(rail);
  if (!channel) throw new Error(`No real disbursement channel for rail "${rail}"`);

  const response = await fetch(`${API_BASE}/disbursements`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: authHeader() },
    body: JSON.stringify({
      external_id: externalId,
      amount: Math.round(amountIdr),
      bank_code: channel,
      account_holder_name: phone,
      account_number: phone,
      description: description.slice(0, 100),
    }),
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body?.message || `Xendit disbursement returned ${response.status}`);
  }

  return { id: body.id, status: body.status, externalId: body.external_id };
}

export interface BankOption {
  code: string;
  name: string;
}

let bankListCache: { fetchedAt: number; banks: BankOption[] } | null = null;
const BANK_LIST_TTL_MS = 60 * 60 * 1000;

/**
 * Real Indonesian bank codes this Xendit account can disburse to — the same
 * `/available_disbursements_banks` list `disbursementChannelFor`'s e-wallet codes come from,
 * minus the wallets themselves. Cached in memory for an hour: it's Xendit's own bank-network
 * coverage, not something that changes minute to minute, and the raw list is 150+ entries.
 */
export async function getAvailableBanks(): Promise<BankOption[]> {
  if (bankListCache && Date.now() - bankListCache.fetchedAt < BANK_LIST_TTL_MS) {
    return bankListCache.banks;
  }

  const response = await fetch(`${API_BASE}/available_disbursements_banks`, {
    headers: { Authorization: authHeader() },
  });
  const body = await response.json().catch(() => []);
  if (!response.ok) {
    throw new Error(body?.message || `Xendit bank list returned ${response.status}`);
  }

  const walletCodes = new Set(Object.values(WALLET_CHANNEL_MAP));
  const banks: BankOption[] = (body as Array<{ code: string; name: string; can_disburse: boolean }>)
    .filter((b) => b.can_disburse && !walletCodes.has(b.code))
    .map((b) => ({ code: b.code, name: b.name }))
    .sort((a, b) => a.name.localeCompare(b.name));

  bankListCache = { fetchedAt: Date.now(), banks };
  return banks;
}

/**
 * Send IDR to a bank account.
 *
 * Unlike a wallet disbursement, a real bank account has its own holder name, and some banks
 * validate it against the receiving account (`can_name_validate` in the bank list) — Saku's
 * phone-hash-only identity model never collects one, so this passes a generic placeholder.
 * Where that fails Xendit's validation, the caller's existing fallback to a simulated payout is
 * what actually handles it — this function is not expected to succeed for every bank, only to
 * really try first, same as `sendWalletDisbursement`.
 */
export async function sendBankDisbursement(
  externalId: string,
  bankCode: string,
  accountNumber: string,
  amountIdr: number,
  description: string
): Promise<DisbursementResult> {
  const response = await fetch(`${API_BASE}/disbursements`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: authHeader() },
    body: JSON.stringify({
      external_id: externalId,
      amount: Math.round(amountIdr),
      bank_code: bankCode,
      account_holder_name: 'Saku User',
      account_number: accountNumber,
      description: description.slice(0, 100),
    }),
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body?.message || `Xendit disbursement returned ${response.status}`);
  }

  return { id: body.id, status: body.status, externalId: body.external_id };
}

export async function getDisbursementStatus(id: string): Promise<DisbursementResult> {
  const response = await fetch(`${API_BASE}/disbursements/${id}`, {
    headers: { Authorization: authHeader() },
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body?.message || `Xendit disbursement lookup returned ${response.status}`);
  }

  return { id: body.id, status: body.status, externalId: body.external_id };
}
