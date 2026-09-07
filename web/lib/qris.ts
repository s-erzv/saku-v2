/**
 * QRIS parsing.
 *
 * QRIS is Indonesia's national merchant QR, built on the EMVCo merchant-presented spec: a flat
 * string of `IDLLVALUE` triples, where ID is two digits, LL is a two-digit length, and VALUE is
 * that many characters. Some IDs nest the same structure inside their value.
 *
 * Reading one is entirely open — no licence, no agreement, no API. What is *not* open is paying
 * one: settling into a merchant's QRIS account requires being a licensed acquirer or issuer,
 * which Saku explicitly is not (PRD Section 2.1). So Saku reads the merchant's real details off
 * the code and then routes the payment through the same cross-rail path as any other off-ramp —
 * on-chain half real, disbursement half simulated and labelled as such.
 *
 * Reference: EMVCo "Merchant-Presented QR Specification for Payment Systems", and Bank
 * Indonesia's QRIS profile of it.
 */

/** Tag IDs used here. The spec defines more; these are the ones a payer screen needs. */
const TAG_POINT_OF_INITIATION = '01';
const TAG_MERCHANT_ACCOUNT_START = 26;
const TAG_MERCHANT_ACCOUNT_END = 51;
const TAG_MERCHANT_CATEGORY = '52';
const TAG_CURRENCY = '53';
const TAG_AMOUNT = '54';
const TAG_COUNTRY = '58';
const TAG_MERCHANT_NAME = '59';
const TAG_MERCHANT_CITY = '60';
const TAG_POSTAL_CODE = '61';
const TAG_CRC = '63';

/** ISO 4217 numeric for IDR — QRIS carries the numeric code, not the letters. */
const CURRENCY_IDR = '360';

export interface QrisPayload {
  merchantName: string | null;
  merchantCity: string | null;
  /** National Merchant ID, when the code carries one. */
  merchantId: string | null;
  /** Acquirer/issuer domain, e.g. "ID.CO.QRIS.WWW". */
  acquirerDomain: string | null;
  /** Fixed amount, when the merchant encoded one. Null means the payer enters it. */
  amount: number | null;
  currency: string;
  countryCode: string | null;
  merchantCategoryCode: string | null;
  /** False for a static merchant code that can be scanned repeatedly. */
  dynamic: boolean;
  /** Whether the trailing CRC-16 matches the payload. */
  crcValid: boolean;
}

type Tlv = Record<string, string>;

/** Parse a flat EMVCo TLV string. Returns null when the structure does not hold. */
function parseTlv(input: string): Tlv | null {
  const out: Tlv = {};
  let i = 0;

  while (i < input.length) {
    // Every entry needs at least an id and a length.
    if (i + 4 > input.length) return null;

    const id = input.slice(i, i + 2);
    const length = Number(input.slice(i + 2, i + 4));
    if (!Number.isInteger(length) || length < 0) return null;

    const start = i + 4;
    const end = start + length;
    if (end > input.length) return null;

    out[id] = input.slice(start, end);
    i = end;
  }

  return out;
}

/**
 * CRC-16/CCITT-FALSE over everything up to and including the CRC tag's own id and length.
 *
 * Worth checking: it is the only thing that distinguishes a real merchant code from a string
 * that happens to look like one, and a payer screen should not present a corrupted scan as a
 * merchant.
 */
function crc16(input: string): string {
  let crc = 0xffff;

  for (let i = 0; i < input.length; i += 1) {
    crc ^= input.charCodeAt(i) << 8;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }

  return crc.toString(16).toUpperCase().padStart(4, '0');
}

export function isQrisPayload(input: string): boolean {
  // Every EMVCo merchant code starts with payload format indicator "000201".
  return /^000201/.test(input.trim());
}

/**
 * Read a QRIS string.
 *
 * @returns the merchant details, or null when the string is not a merchant QR at all.
 */
export function parseQris(input: string): QrisPayload | null {
  const raw = input.trim();
  if (!isQrisPayload(raw)) return null;

  const root = parseTlv(raw);
  if (!root) return null;

  // The CRC covers the payload up to and including "6304".
  const crcIndex = raw.lastIndexOf(`${TAG_CRC}04`);
  const crcValid =
    crcIndex > 0 && crc16(raw.slice(0, crcIndex + 4)) === (root[TAG_CRC] ?? '').toUpperCase();

  // Merchant account information lives in one of tags 26-51, each a nested TLV whose first
  // entry is the acquirer's reverse-domain identifier.
  let merchantId: string | null = null;
  let acquirerDomain: string | null = null;

  for (let tag = TAG_MERCHANT_ACCOUNT_START; tag <= TAG_MERCHANT_ACCOUNT_END; tag += 1) {
    const value = root[String(tag).padStart(2, '0')];
    if (!value) continue;

    const nested = parseTlv(value);
    if (!nested) continue;

    acquirerDomain = acquirerDomain ?? nested['00'] ?? null;
    // 01 is the merchant PAN, 02 the national merchant id; either identifies the merchant.
    merchantId = merchantId ?? nested['02'] ?? nested['01'] ?? null;
    if (merchantId) break;
  }

  const amountRaw = root[TAG_AMOUNT];
  const amount = amountRaw !== undefined ? Number(amountRaw) : null;

  return {
    merchantName: root[TAG_MERCHANT_NAME]?.trim() || null,
    merchantCity: root[TAG_MERCHANT_CITY]?.trim() || null,
    merchantId,
    acquirerDomain,
    amount: Number.isFinite(amount) && amount !== null && amount > 0 ? amount : null,
    currency: root[TAG_CURRENCY] === CURRENCY_IDR ? 'IDR' : (root[TAG_CURRENCY] ?? 'IDR'),
    countryCode: root[TAG_COUNTRY] ?? null,
    merchantCategoryCode: root[TAG_MERCHANT_CATEGORY] ?? null,
    // "11" is a static code, "12" a dynamic one carrying a single transaction's amount.
    dynamic: root[TAG_POINT_OF_INITIATION] === '12',
    crcValid,
  };
}

void TAG_POSTAL_CODE;
