/**
 * Open a packet (GET) and claim from it (POST).
 *
 * Claiming has one hard requirement: nobody gets paid twice, and the shares never exceed what
 * was funded. Both come from the same mechanism — the `UNIQUE (packet_id, claimer_id)` row is
 * inserted *before* any payout, so two simultaneous claims from the same person leave one
 * insert colliding and one payout happening. The share itself is computed from what remains,
 * inside the same request, so it cannot overdraw the packet.
 */

import { NextResponse } from 'next/server';
import { formatUnits } from 'ethers';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { verifyToken, extractTokenFromHeader } from '@/lib/jwt';
import { CHAIN_ID, USDC_DECIMALS, getSettler, getUsdcAddress, payoutUsdc } from '@/lib/chain';
import { nextShare, type SplitMode } from '@/lib/packet';
import { describeDbError } from '@/lib/db-errors';

interface PacketRow {
  id: string;
  code: string;
  creator_id: string;
  total_amount: string;
  slots: number;
  split_mode: SplitMode;
  theme: string | null;
  message: string | null;
  restricted_to_hashes: string[] | null;
  status: string;
  expires_at: string;
}

async function requireSession(request: Request) {
  const sessionToken = extractTokenFromHeader(request.headers.get('authorization'));
  if (!sessionToken) return null;
  try {
    return await verifyToken(sessionToken);
  } catch {
    return null;
  }
}

async function loadPacket(code: string): Promise<PacketRow | null> {
  const supabase = getSupabaseAdmin();
  const { data } = await supabase
    .from('packets')
    .select('id, code, creator_id, total_amount, slots, split_mode, theme, message, restricted_to_hashes, status, expires_at')
    .eq('code', code.toUpperCase())
    .maybeSingle();

  return (data as PacketRow | null) ?? null;
}

export async function GET(request: Request, { params }: { params: Promise<{ code: string }> }) {
  const session = await requireSession(request);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { code } = await params;

  try {
    const packet = await loadPacket(code);
    if (!packet) return NextResponse.json({ error: 'Packet not found' }, { status: 404 });

    const supabase = getSupabaseAdmin();
    const { data: claims } = await supabase
      .from('packet_claims')
      .select('claimer_id, amount, claimed_at')
      .eq('packet_id', packet.id);

    const taken = claims ?? [];
    const claimedTotal = taken.reduce((sum, c) => sum + BigInt(c.amount), BigInt(0));
    const mine = taken.find((c) => c.claimer_id === session.userId);

    const expired = new Date(packet.expires_at).getTime() < Date.now();
    // Restricted packets reveal nothing beyond "not for you" — the hash list is never returned.
    const invited =
      !packet.restricted_to_hashes || packet.restricted_to_hashes.includes(session.phoneHash);

    return NextResponse.json({
      code: packet.code,
      theme: packet.theme,
      message: packet.message,
      splitMode: packet.split_mode,
      slots: packet.slots,
      claimedCount: taken.length,
      totalAmount: formatUnits(packet.total_amount, USDC_DECIMALS),
      remainingAmount: formatUnits(BigInt(packet.total_amount) - claimedTotal, USDC_DECIMALS),
      status: expired && packet.status === 'open' ? 'expired' : packet.status,
      isCreator: packet.creator_id === session.userId,
      alreadyClaimed: !!mine,
      myAmount: mine ? formatUnits(mine.amount, USDC_DECIMALS) : null,
      claimable:
        packet.status === 'open' &&
        !expired &&
        invited &&
        !mine &&
        taken.length < packet.slots &&
        BigInt(packet.total_amount) - claimedTotal > BigInt(0),
      invited,
    });
  } catch {
    return NextResponse.json({ error: 'Could not open this packet' }, { status: 500 });
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ code: string }> }) {
  const session = await requireSession(request);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { code } = await params;

  try {
    const packet = await loadPacket(code);
    if (!packet) return NextResponse.json({ error: 'Packet not found' }, { status: 404 });

    if (packet.status !== 'open') {
      return NextResponse.json({ error: `This packet is ${packet.status}` }, { status: 400 });
    }
    if (new Date(packet.expires_at).getTime() < Date.now()) {
      return NextResponse.json({ error: 'This packet has expired' }, { status: 400 });
    }
    if (packet.restricted_to_hashes && !packet.restricted_to_hashes.includes(session.phoneHash)) {
      return NextResponse.json({ error: 'This packet is not for your number' }, { status: 403 });
    }

    const supabase = getSupabaseAdmin();

    const { data: wallet } = await supabase
      .from('wallets')
      .select('address')
      .eq('user_id', session.userId)
      .eq('chain_id', CHAIN_ID)
      .maybeSingle();

    if (!wallet?.address) {
      return NextResponse.json({ error: 'Finish setting up your wallet first' }, { status: 400 });
    }

    const { data: claims } = await supabase
      .from('packet_claims')
      .select('amount')
      .eq('packet_id', packet.id);

    const taken = claims ?? [];
    if (taken.length >= packet.slots) {
      return NextResponse.json({ error: 'This packet is empty' }, { status: 400 });
    }

    const claimedTotal = taken.reduce((sum, c) => sum + BigInt(c.amount), BigInt(0));
    const remaining = BigInt(packet.total_amount) - claimedTotal;
    if (remaining <= BigInt(0)) {
      return NextResponse.json({ error: 'This packet is empty' }, { status: 400 });
    }

    const share = nextShare(remaining, packet.slots - taken.length, packet.split_mode);

    // Claim the slot before paying. A second attempt by the same user collides on the unique
    // constraint and is rejected here, which is what makes the payout below happen once.
    const { error: claimError } = await supabase
      .from('packet_claims')
      .insert({ packet_id: packet.id, claimer_id: session.userId, amount: share.toString() });

    if (claimError) {
      if (claimError.code === '23505') {
        return NextResponse.json({ error: 'You already claimed this packet' }, { status: 409 });
      }
      throw claimError;
    }

    try {
      const receipt = await payoutUsdc(wallet.address, share);

      await supabase
        .from('packet_claims')
        .update({ payout_tx_hash: receipt.hash.toLowerCase() })
        .eq('packet_id', packet.id)
        .eq('claimer_id', session.userId);

      await supabase.from('transactions').insert({
        tx_hash: receipt.hash.toLowerCase(),
        chain_id: CHAIN_ID,
        type: 'transfer',
        status: 'confirmed',
        from_address: getSettler().address.toLowerCase(),
        to_address: wallet.address.toLowerCase(),
        token_address: getUsdcAddress().toLowerCase(),
        amount: share.toString(),
        user_id: session.userId,
        counterparty_user_id: packet.creator_id,
        block_number: receipt.blockNumber,
      });

      // Last slot or last unit closes the packet.
      if (taken.length + 1 >= packet.slots || remaining - share <= BigInt(0)) {
        await supabase.from('packets').update({ status: 'emptied' }).eq('id', packet.id);
      }

      await supabase.from('notifications').insert({
        user_id: packet.creator_id,
        type: 'transfer_sent',
        message: 'Someone claimed your packet.',
        metadata: { packet_code: packet.code, amount: share.toString() },
      });

      return NextResponse.json({
        success: true,
        amount: formatUnits(share, USDC_DECIMALS),
        payoutTxHash: receipt.hash,
      });
    } catch (payoutError) {
      // The slot was claimed but the transfer failed. Release it rather than leaving the user
      // holding a claim worth nothing they cannot retry.
      await supabase
        .from('packet_claims')
        .delete()
        .eq('packet_id', packet.id)
        .eq('claimer_id', session.userId)
        .is('payout_tx_hash', null);

      const reason = payoutError instanceof Error ? payoutError.message : 'Payout failed';
      return NextResponse.json({ error: reason }, { status: 500 });
    }
  } catch (error) {
    const { message, isSchemaDrift, code: dbCode } = describeDbError(error, 'Could not claim this packet');
    console.error('[packet/claim]', dbCode ?? '', message);
    return NextResponse.json({ error: message, schemaOutOfDate: isSchemaDrift || undefined }, { status: 500 });
  }
}
