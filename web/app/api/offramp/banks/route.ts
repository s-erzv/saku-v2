/**
 * The real list of banks this Xendit account can disburse to, for the `bank` rail's destination
 * picker. Session-gated like every other offramp route, even though the list itself isn't
 * sensitive — there's no reason to let it be scraped by anyone who isn't logged in.
 */

import { NextResponse } from 'next/server';
import { getSession, unauthorized } from '@/lib/session';
import { getAvailableBanks } from '@/lib/xendit-disbursement';

export async function GET(request: Request) {
  const session = await getSession(request);
  if (!session) return unauthorized();

  try {
    const banks = await getAvailableBanks();
    return NextResponse.json({ banks });
  } catch (error) {
    console.error('[offramp/banks]', error);
    return NextResponse.json({ error: 'Could not load bank list' }, { status: 502 });
  }
}
