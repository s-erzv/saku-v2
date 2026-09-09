/**
 * Hash a destination identifier for a cross-rail transfer — a phone number for e-wallet rails,
 * or a bank code + account number for the `bank` rail.
 *
 * Separate from `/api/transfer/resolve` because the requirement is the opposite one. That route
 * refuses a number that is not on Saku, since a Saku-to-Saku transfer needs a wallet address.
 * Here the recipient is expected *not* to have a wallet — the whole point of PRD Section 3 is
 * Rani sending to Budi, who only has GoPay. All the escrow needs is the hash.
 *
 * The hash is produced server-side with the same functions the escrow uses (`lib/phone.ts`,
 * `lib/bank-recipient.ts`), so the client never derives an identifier the contract will trust.
 */

import { NextResponse } from 'next/server';
import { getSession, unauthorized } from '@/lib/session';
import { hashPhone, InvalidPhoneNumberError } from '@/lib/phone';
import { hashBankRecipient, InvalidBankAccountError } from '@/lib/bank-recipient';
import { checkRateLimit, RATE_LIMITS } from '@/lib/rate-limiter';
import { clientKey } from '@/lib/request-meta';

export async function POST(request: Request) {
  const session = await getSession(request);
  if (!session) return unauthorized();

  if (!(await checkRateLimit(clientKey(request, 'offramp-recipient'), RATE_LIMITS.IP_BASED)).allowed) {
    return NextResponse.json({ error: 'Too many lookups. Try again shortly.' }, { status: 429 });
  }

  try {
    const body = await request.json();

    const recipientHash =
      body.rail === 'bank'
        ? hashBankRecipient(body.bankCode, body.accountNumber)
        : hashPhone(body.phone, body.countryCode || '62');

    // Deliberately returns nothing about whether this number is registered on Saku. It does not
    // affect the transfer, and answering would make this a cheaper enumeration oracle than the
    // transfer resolver — which at least has a reason to answer.
    return NextResponse.json({ recipientHash });
  } catch (error) {
    if (error instanceof InvalidPhoneNumberError) {
      return NextResponse.json({ error: 'Invalid phone number' }, { status: 400 });
    }
    if (error instanceof InvalidBankAccountError) {
      return NextResponse.json({ error: 'Invalid account number' }, { status: 400 });
    }
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  }
}
