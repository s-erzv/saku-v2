/**
 * Packets waiting for the caller.
 *
 * A packet restricted to specific numbers (`restricted_to_hashes`) is the "private circle" case:
 * the recipients never get a link, so without this route the packet is invisible to exactly the
 * people it was made for. Public packets are deliberately absent — those travel by link or code,
 * and listing every open packet on the network would turn a gift into a feed to farm.
 *
 * Already-claimed packets drop out: this is a to-do list, not a history (that is `/mine`).
 */

import { NextResponse } from 'next/server';
import { formatUnits } from 'ethers';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { verifyToken, extractTokenFromHeader } from '@/lib/jwt';
import { USDC_DECIMALS } from '@/lib/chain';

export async function GET(request: Request) {
  const sessionToken = extractTokenFromHeader(request.headers.get('authorization'));
  if (!sessionToken) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let session;
  try {
    session = await verifyToken(sessionToken);
  } catch {
    return NextResponse.json({ error: 'Invalid or expired session' }, { status: 401 });
  }

  try {
    const supabase = getSupabaseAdmin();

    const { data: packets, error } = await supabase
      .from('packets')
      .select('id, code, creator_id, theme, message, total_amount, slots, status, expires_at, created_at')
      .contains('restricted_to_hashes', [session.phoneHash])
      .eq('status', 'open')
      .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`)
      .order('created_at', { ascending: false })
      .limit(20);

    if (error) {
      // The column only exists after the packet migration; an empty inbox beats a 500 on Home.
      if (error.code === 'PGRST205' || error.code === '42P01') {
        return NextResponse.json({ packets: [] });
      }
      throw error;
    }

    const rows = packets ?? [];
    if (rows.length === 0) return NextResponse.json({ packets: [] });

    const ids = rows.map((p) => p.id);

    // Two batched lookups rather than a pair per packet: every claim on this page, and every
    // creator's name.
    const [{ data: claims }, { data: creators }] = await Promise.all([
      supabase.from('packet_claims').select('packet_id, claimer_id, amount').in('packet_id', ids),
      supabase
        .from('users')
        .select('id, display_name')
        .in('id', [...new Set(rows.map((p) => p.creator_id))]),
    ]);

    const nameById = new Map((creators ?? []).map((u) => [u.id, u.display_name]));
    const claimedByMe = new Set(
      (claims ?? []).filter((c) => c.claimer_id === session.userId).map((c) => c.packet_id)
    );

    const claimsByPacket = new Map<string, { count: number; total: bigint }>();
    for (const claim of claims ?? []) {
      const entry = claimsByPacket.get(claim.packet_id) ?? { count: 0, total: BigInt(0) };
      entry.count += 1;
      entry.total += BigInt(claim.amount);
      claimsByPacket.set(claim.packet_id, entry);
    }

    const waiting = rows
      .filter((p) => !claimedByMe.has(p.id))
      .map((p) => {
        const taken = claimsByPacket.get(p.id) ?? { count: 0, total: BigInt(0) };
        const remaining = BigInt(p.total_amount) - taken.total;
        return {
          code: p.code,
          theme: p.theme,
          message: p.message,
          fromName: nameById.get(p.creator_id) ?? null,
          totalAmount: formatUnits(p.total_amount, USDC_DECIMALS),
          remainingAmount: formatUnits(remaining > BigInt(0) ? remaining : BigInt(0), USDC_DECIMALS),
          slots: p.slots,
          claimedCount: taken.count,
          expiresAt: p.expires_at,
        };
      })
      // Nothing left to win is not something to advertise as waiting.
      .filter((p) => p.claimedCount < p.slots && Number(p.remainingAmount) > 0);

    return NextResponse.json({ packets: waiting });
  } catch (error) {
    console.error('[packet/invited] failed:', error);
    return NextResponse.json({ error: 'Could not load your packets' }, { status: 500 });
  }
}
