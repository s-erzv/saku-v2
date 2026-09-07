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
 * @param raw    User input in any format: `+62 812-3456-7890`, `0812 3456 7890`, `62812...`
 * @param country Dialling code used to expand a national `0` prefix. Defaults to Indonesia.
 * @throws InvalidPhoneNumberError when the result is not a plausible E.164 number. Callers must
 *         let this reject the request — an unvalidated string ends up in the OTP gateway's
 *         request body and in the database.
 */
export function normalizePhone(raw: string, country = '62'): string {
  if (typeof raw !== 'string') throw new InvalidPhoneNumberError();

  const countryDigits = country.replace(/\D/g, '');
  let digits = raw.replace(/\D/g, '');

  if (digits.startsWith('0')) {
    digits = countryDigits + digits.replace(/^0+/, '');
  }

  if (!E164_DIGITS.test(digits)) throw new InvalidPhoneNumberError();
  return digits;
}

/**
 * keccak256 of the normalized number — the value stored as `users.phone_hash`, sent to the
 * escrow as `recipientPhoneHash`, and used as the Web3Auth `verifierId`.
 *
 * Note this is not a secret-keyed hash: a phone number has far too little entropy for the hash
 * alone to hide it from someone willing to enumerate. It has to stay unkeyed because the same
 * value must be derivable by the smart contract and by Web3Auth. What it buys is that a
 * database dump contains no directly usable contact list, and that no plain number sits in
 * logs, backups, or a third party's records.
 */
export function hashPhone(raw: string, country = '62'): string {
  return ethers.keccak256(ethers.toUtf8Bytes(normalizePhone(raw, country)));
}

/** True when the value is a well-formed keccak256 hex string, matching the `hash32` domain. */
export function isPhoneHash(value: unknown): value is string {
  return typeof value === 'string' && /^0x[0-9a-f]{64}$/.test(value);
}
