/**
 * The caller's own packets: the ones they sent, and the ones they have opened.
 *
 * v1 had this as two routes (`my-packets` and `my-claims`) feeding one screen. It is one round
 * trip here because it is one screen — and because both halves need the same batched claim
 * lookup, which is wasted work done twice.
 */

import { NextResponse } from 'next/server';
import { formatUnits } from 'ethers';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { getSession, unauthorized } from '@/lib/session';
import { USDC_DECIMALS } from '@/lib/chain';

export async function GET(request: Request) {
  const session = await getSession(request);
  if (!session) return unauthorized();

  try {
    const supabase = getSupabaseAdmin();

    const [{ data: mine, error: mineError }, { data: myClaims }] = await Promise.all([
      supabase
        .from('packets')
        .select('id, code, theme, message, total_amount, slots, split_mode, status, restricted_to_hashes, expires_at, created_at')
        .eq('creator_id', session.userId)
        .order('created_at', { ascending: false })
        .limit(50),
      supabase
        .from('packet_claims')
        .select('packet_id, amount, claimed_at, payout_tx_hash, packets(code, theme, creator_id)')
        .eq('claimer_id', session.userId)
        .order('claimed_at', { ascending: false })
        .limit(50),
    ]);

    if (mineError) {
      if (mineError.code === 'PGRST205' || mineError.code === '42P01') {
        return NextResponse.json({ created: [], claimed: [] });
      }
      throw mineError;
    }

    const rows = mine ?? [];

    // One lookup for every claim across every packet this user created, plus one for the names
    // behind them. The creator can see who opened their own packet and for how much — that is
    // the question "who got it?" and it is theirs to ask. Nothing beyond a display name is
    // returned: no phone number, no hash, no wallet.
    const claimsByPacket = new Map<
      string,
      { count: number; total: bigint; claims: { name: string | null; amount: string; claimedAt: string }[] }
    >();

    if (rows.length > 0) {
      const { data: claims } = await supabase
        .from('packet_claims')
        .select('packet_id, claimer_id, amount, claimed_at')
        .in('packet_id', rows.map((p) => p.id))
        .order('claimed_at', { ascending: true });

      const claimerIds = [...new Set((claims ?? []).map((c) => c.claimer_id).filter(Boolean))];
      const nameById = new Map<string, string>();
      if (claimerIds.length > 0) {
        const { data: claimers } = await supabase
          .from('users')
          .select('id, display_name')
          .in('id', claimerIds);
        for (const user of claimers ?? []) {
          if (user.display_name) nameById.set(user.id, user.display_name);
        }
      }

      for (const claim of claims ?? []) {
        const entry =
          claimsByPacket.get(claim.packet_id) ?? { count: 0, total: BigInt(0), claims: [] };
        entry.count += 1;
        entry.total += BigInt(claim.amount);
        entry.claims.push({
          name: nameById.get(claim.claimer_id) ?? null,
          amount: formatUnits(claim.amount, USDC_DECIMALS),
          claimedAt: claim.claimed_at,
        });
        claimsByPacket.set(claim.packet_id, entry);
      }
    }

    const now = Date.now();

    const created = rows.map((p) => {
      const taken = claimsByPacket.get(p.id) ?? { count: 0, total: BigInt(0), claims: [] };
      const remaining = BigInt(p.total_amount) - taken.total;
      const expired = p.expires_at !== null && new Date(p.expires_at).getTime() < now;

      return {
        code: p.code,
        theme: p.theme,
        message: p.message,
        totalAmount: formatUnits(p.total_amount, USDC_DECIMALS),
        remainingAmount: formatUnits(remaining > BigInt(0) ? remaining : BigInt(0), USDC_DECIMALS),
        slots: p.slots,
        claimedCount: taken.count,
        claims: taken.claims,
        splitMode: p.split_mode,
        // Whether it was a private circle, not who was in it — the hashes never leave the server.
        isPrivate: (p.restricted_to_hashes ?? []).length > 0,
        invitedCount: (p.restricted_to_hashes ?? []).length,
        status: expired && p.status === 'open' ? 'expired' : p.status,
        expiresAt: p.expires_at,
        createdAt: p.created_at,
      };
    });

    // A creator id is not a name and the claim rows carry no display name; resolving one here
    // would be a second query for a line that reads fine as the packet's own code.
    const claimed = (myClaims ?? []).map((c) => {
      const packet = c.packets as unknown as { code: string; theme: string | null } | null;
      return {
        code: packet?.code ?? null,
        theme: packet?.theme ?? null,
        amount: formatUnits(c.amount, USDC_DECIMALS),
        claimedAt: c.claimed_at,
        txHash: c.payout_tx_hash,
      };
    });

    return NextResponse.json({ created, claimed });
  } catch (error) {
    console.error('[packet/mine] failed:', error);
    return NextResponse.json({ error: 'Could not load your packets' }, { status: 500 });
  }
}
