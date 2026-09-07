/**
 * Identifying a bank-transfer recipient on-chain, the same way `lib/phone.ts` identifies a
 * phone-based one: hash it server-side, store only the hash, keep the plaintext (bank code +
 * account number) off the chain and off the database.
 *
 * Kept separate from `hashPhone` deliberately — a bank account number is a different kind of
 * identifier with different validation rules, and folding it into the phone hasher would make
 * "what does this hash actually identify" ambiguous everywhere the hash is read back.
 */

import { ethers } from 'ethers';

const ACCOUNT_NUMBER = /^[0-9]{4,20}$/;

export class InvalidBankAccountError extends Error {
  constructor() {
    super('Invalid bank account number');
    this.name = 'InvalidBankAccountError';
  }
}

/** keccak256 of `bankCode:accountNumber` — the escrow's `recipientPhoneHash` field for a `bank` rail lock. */
export function hashBankRecipient(bankCode: string, accountNumber: string): string {
  const code = bankCode.trim().toUpperCase();
  const number = accountNumber.trim();
  if (!code) throw new InvalidBankAccountError();
  if (!ACCOUNT_NUMBER.test(number)) throw new InvalidBankAccountError();

  return ethers.keccak256(ethers.toUtf8Bytes(`${code}:${number}`));
}
