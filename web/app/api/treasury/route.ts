/**
 * Where platform fees and packet funding are sent.
 *
 * Served rather than shipped in client config for one reason: it is a destination for real
 * transfers, and a stale bundle holding an old address would send money nowhere recoverable.
 * Behind a session because there is no reason to advertise the treasury to anyone who asks.
 *
 * Replaces `/api/packet/treasury`, which was the same address under a name that stopped being
 * true once fees started going to it as well.
 */

import { NextResponse } from 'next/server';
import { getSettler } from '@/lib/chain';
import { getSession, unauthorized } from '@/lib/session';

export async function GET(request: Request) {
  const session = await getSession(request);
  if (!session) return unauthorized();

  return NextResponse.json({ treasury: getSettler().address });
}
