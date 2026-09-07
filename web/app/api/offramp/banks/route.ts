/**
 * The real list of banks this Xendit account can disburse to, for the `bank` rail's destination
 * picker. Session-gated like every other offramp route, even though the list itself isn't
 * sensitive — there's no reason to let it be scraped by anyone who isn't logged in.
 */

import { NextResponse } from 'next/server';
import { verifyToken, extractTokenFromHeader } from '@/lib/jwt';
import { getAvailableBanks } from '@/lib/xendit-disbursement';

export async function GET(request: Request) {
  const sessionToken = extractTokenFromHeader(request.headers.get('authorization'));
  if (!sessionToken) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    await verifyToken(sessionToken);
  } catch {
    return NextResponse.json({ error: 'Invalid or expired session' }, { status: 401 });
  }

  try {
    const banks = await getAvailableBanks();
    return NextResponse.json({ banks });
  } catch (error) {
    console.error('[offramp/banks]', error);
    return NextResponse.json({ error: 'Could not load bank list' }, { status: 502 });
  }
}
