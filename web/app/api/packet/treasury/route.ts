/**
 * Where to send packet funding.
 *
 * The address is served rather than shipped in client config for one reason: it is a
 * destination for real transfers, and a stale bundle holding an old address would send money
 * somewhere nobody is watching. Requiring a session keeps it from being a public endpoint that
 * advertises the treasury to anyone who asks.
 */

import { NextResponse } from 'next/server';
import { verifyToken, extractTokenFromHeader } from '@/lib/jwt';
import { getSettler } from '@/lib/chain';

export async function GET(request: Request) {
  const sessionToken = extractTokenFromHeader(request.headers.get('authorization'));
  if (!sessionToken) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    await verifyToken(sessionToken);
  } catch {
    return NextResponse.json({ error: 'Invalid or expired session' }, { status: 401 });
  }

  try {
    return NextResponse.json({
      treasury: getSettler().address,
      // Stated in the response so a client that shows a confirmation can be honest about it.
      custodial: true,
      note: 'Packet funds are held by Saku between funding and claim.',
    });
  } catch {
    return NextResponse.json({ error: 'Packets are not configured' }, { status: 500 });
  }
}
