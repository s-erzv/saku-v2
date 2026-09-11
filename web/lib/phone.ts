/**
 * The single source of truth for turning a phone number into an identifier.
 *
 * v1 had two implementations that disagreed: `lib/blockchain.ts:hashPhone` stripped non-digits
 * only, while `utils/phoneHash.ts:hashPhoneNumber` also rewrote a leading `0` to the country
 * code. `08123...` therefore hashed to two different values depending on which route ran, so
 * the same person could end up as two identities. In v2 `users.phone_hash` is UNIQUE, so that
 * bug would now surface as a hard constraint violation instead of silent duplication — which
 * is better, but the real fix is to have exactly one function. This is it.
 *
 * Nothing outside this module should call keccak256 on a phone number.
 */

import { createHmac } from 'crypto';

import { ethers } from 'ethers';

/** Digits only, no `+`. Loose on purpose — country numbering plans vary across ASEAN. */
const E164_DIGITS = /^[1-9]\d{7,14}$/;

export class InvalidPhoneNumberError extends Error {
  constructor() {
    super('Invalid phone number');
    this.name = 'InvalidPhoneNumberError';
  }
}

/**
 * Normalize to bare international digits.
 *
 * The country code is always applied, not only when the input happens to start with a national
 * `0` — that used to be the only branch that consulted `country` at all, so a number typed
 * without one (which is exactly this app's own placeholder, "812 3456 7890", and is simply how
 * Singapore's numbering plan is written natively) hashed with no country code in it whatsoever.
 * Two different countries' users whose national digits happened to match then collided on the
 * same identity, and the same person typing their own number with vs without a leading `0`
 * disagreed with themselves. Every branch below now ends up at `country digits + national
 * number`, so the result no longer depends on which of those input shapes the caller used.
 *
 * @param raw    User input in any format: `+62 812-3456-7890`, `0812 3456 7890`, `62812...`
 * @param country Dialling code the national number belongs to. Defaults to Indonesia.
 * @throws InvalidPhoneNumberError when the result is not a plausible E.164 number. Callers must
 *         let this reject the request — an unvalidated string ends up in the OTP gateway's
 *         request body and in the database.
 */
export function normalizePhone(raw: string, country = '62'): string {
  if (typeof raw !== 'string') throw new InvalidPhoneNumberError();

  const countryDigits = country.replace(/\D/g, '');
  let digits = raw.replace(/\D/g, '');

  if (digits.startsWith('0')) {
    digits = digits.replace(/^0+/, '');
  } else if (digits.startsWith(countryDigits) && digits.length > countryDigits.length) {
    // Already a full international number (e.g. pasted as `62812...`) — strip it back off
    // rather than prepending a second copy below.
    digits = digits.slice(countryDigits.length);
  }

  digits = countryDigits + digits;

  if (!E164_DIGITS.test(digits)) throw new InvalidPhoneNumberError();
  return digits;
}

/** The rule {@link hashPhone} currently applies. Stored per row as `users.phone_hash_version`. */
export const CURRENT_PHONE_HASH_VERSION = 2;

/**
 * Version 1: bare keccak256 of the normalized number.
 *
 * Kept only to read rows written before the pepper existed, and to find them during the
 * migration in `lib/phone-identity.ts`. Nothing should write this value any more.
 *
 * The reason it was unkeyed no longer holds. The comment here used to say the value had to stay
 * derivable by the smart contract and by Web3Auth. Web3Auth is gone, and the escrow never
 * computes the hash — `recipientPhoneHash` is a parameter it stores and never inspects. So the
 * constraint that forced an unkeyed hash was removed by two migrations that did not notice they
 * had removed it.
 *
 * What it cost: a mobile number carries roughly thirty bits of entropy. An unkeyed hash of one
 * is not an anonymisation, it is an encoding, and anyone holding a database dump — or reading
 * the escrow's public storage, where these went on-chain in the clear — recovers every number
 * by enumerating the space.
 */
export function hashPhoneLegacy(raw: string, country = '62'): string {
  return ethers.keccak256(ethers.toUtf8Bytes(normalizePhone(raw, country)));
}

/**
 * Fail closed, the same way `lib/otp.ts` does for its own pepper.
 *
 * A missing pepper here would not throw; it would quietly hash everyone with an empty key and
 * hand back exactly the enumerable digest this function exists to stop, under a name that says
 * otherwise. A hard failure at the first request is the louder and cheaper outcome.
 */
function pepper(): string {
  const value = process.env.PHONE_HMAC_PEPPER;
  if (!value || value.length < 32) {
    throw new Error('PHONE_HMAC_PEPPER is missing or too short (want 32+ chars)');
  }
  return value;
}

/**
 * Version 2: HMAC-SHA256 of the normalized number under a server-side pepper.
 *
 * Peppered, not salted. Every lookup here starts from a phone number and no idea which row it
 * belongs to — that is the whole shape of logging in — so a per-row salt would turn an index
 * probe into a scan that tries every row's salt in turn. One shared secret, held outside the
 * database, keeps the lookup O(1) and still means a stolen dump alone reveals nothing.
 *
 * Output is 32 bytes in the same `0x`-prefixed lowercase hex as version 1, so it satisfies the
 * existing `hash32` column domain and {@link isPhoneHash} unchanged. The two versions are
 * therefore indistinguishable by shape, which is why the version is recorded per row rather
 * than inferred.
 */
export function hashPhone(raw: string, country = '62'): string {
  const digest = createHmac('sha256', pepper()).update(normalizePhone(raw, country)).digest('hex');
  return `0x${digest}`;
}

/**
 * Both hashes for one number, current rule first.
 *
 * Callers that resolve a number to an existing account have to try version 1 as well, because a
 * user who has not signed in since the pepper landed still has a version 1 row: their number is
 * not stored, so nothing could have rewritten it in advance. Callers that only *write* a hash
 * use {@link hashPhone} alone.
 */
export function phoneHashCandidates(
  raw: string,
  country = '62'
): Array<{ version: number; hash: string }> {
  return [
    { version: CURRENT_PHONE_HASH_VERSION, hash: hashPhone(raw, country) },
    { version: 1, hash: hashPhoneLegacy(raw, country) },
  ];
}

/**
 * The most of a number Saku is willing to write down: its dialling code and its last four digits.
 *
 * Everything else is protected by {@link hashPhone} and is not recoverable, which is the point.
 * That also left the profile screen unable to answer "what is my number?" — it could say the
 * number was verified and nothing more, which is no help to someone holding two SIMs.
 *
 * Four digits plus a dialling code is the shape a bank prints on a statement: enough for the
 * holder to recognise their own number, and not enough to identify or reach anyone, since the
 * digits that carry the entropy are exactly the ones left out.
 *
 * Derived from the normalized number rather than the raw input, so `0812...`, `+62 812...` and
 * `812...` all yield the same four digits instead of three different answers.
 */
export function phoneHint(raw: string, country = '62'): { dialCode: string; last4: string } {
  const digits = normalizePhone(raw, country);
  return { dialCode: country.replace(/\D/g, ''), last4: digits.slice(-4) };
}

/** True when the value is a well-formed keccak256 hex string, matching the `hash32` domain. */
export function isPhoneHash(value: unknown): value is string {
  return typeof value === 'string' && /^0x[0-9a-f]{64}$/.test(value);
}
