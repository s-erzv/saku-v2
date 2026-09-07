/**
 * One bill: who owes what (GET), and filing a paid share (POST).
 *
 * Paying is an ordinary transfer from the participant to the bill's creator, signed on the
 * participant's device. This route only records it — and, as everywhere else, records it from
 * the on-chain receipt rather than from what the caller claims to have sent.
 */

import { NextResponse } from 'next/server';
import { formatUnits, Interface, id as keccakId } from 'ethers';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { verifyToken, extractTokenFromHeader } from '@/lib/jwt';
import { CHAIN_ID, USDC_DECIMALS, getProvider, getUsdcAddress } from '@/lib/chain';
import { describeDbError } from '@/lib/db-errors';

const TX_HASH = /^0x[0-9a-fA-F]{64}$/;
const TRANSFER_TOPIC = keccakId('Transfer(address,address,uint256)');
const ERC20_INTERFACE = new Interface([
  'event Transfer(address indexed from, address indexed to, uint256 value)',
]);

interface BillRow {
  id: string;
  creator_id: string;
  creator_address: string;
  title: string;
  total_amount: string;
  status: string;
  created_at: string;
}

interface ShareRow {
  id: string;
  participant_phone_hash: string;
  participant_user_id: string | null;
  label: string | null;
  amount: string;
  status: string;
  paid_tx_hash: string | null;
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

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession(request);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;

  try {
    const supabase = getSupabaseAdmin();

    const { data: billData } = await supabase
      .from('split_bills')
      .select('id, creator_id, creator_address, title, total_amount, status, created_at')
      .eq('id', id)
      .maybeSingle();

    const bill = billData as BillRow | null;
    if (!bill) return NextResponse.json({ error: 'Bill not found' }, { status: 404 });

    const { data: sharesData } = await supabase
      .from('split_bill_shares')
      .select('id, participant_phone_hash, participant_user_id, label, amount, status, paid_tx_hash')
      .eq('bill_id', id);

    const shares = (sharesData ?? []) as ShareRow[];
    const mine = shares.find((s) => s.participant_phone_hash === session.phoneHash);

    // Only people involved in the bill may read it.
    if (bill.creator_id !== session.userId && !mine) {
      return NextResponse.json({ error: 'Bill not found' }, { status: 404 });
    }

    return NextResponse.json({
      id: bill.id,
      title: bill.title,
      totalAmount: formatUnits(bill.total_amount, USDC_DECIMALS),
      status: bill.status,
      createdAt: bill.created_at,
      creatorAddress: bill.creator_address,
      isCreator: bill.creator_id === session.userId,
      myShare: mine
        ? { id: mine.id, amount: formatUnits(mine.amount, USDC_DECIMALS), status: mine.status }
        : null,
      // Phone hashes are never returned — a label, an amount and a status is all a bill needs
      // to render, and the hash would be a lookup key for someone else's identity.
      shares: shares.map((s) => ({
        id: s.id,
        label: s.label ?? 'Someone',
        amount: formatUnits(s.amount, USDC_DECIMALS),
        status: s.status,
        isMe: s.participant_phone_hash === session.phoneHash,
      })),
      paidCount: shares.filter((s) => s.status === 'paid').length,
    });
  } catch {
    return NextResponse.json({ error: 'Could not load this bill' }, { status: 500 });
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession(request);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;

  try {
    const body = await request.json();
    const txHash = String(body.txHash ?? '');
    if (!TX_HASH.test(txHash)) {
      return NextResponse.json({ error: 'Invalid transaction hash' }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();

    const { data: billData } = await supabase
      .from('split_bills')
      .select('id, creator_id, creator_address, title, total_amount, status, created_at')
      .eq('id', id)
      .maybeSingle();

    const bill = billData as BillRow | null;
    if (!bill) return NextResponse.json({ error: 'Bill not found' }, { status: 404 });

    const { data: shareData } = await supabase
      .from('split_bill_shares')
      .select('id, participant_phone_hash, participant_user_id, label, amount, status, paid_tx_hash')
      .eq('bill_id', id)
      .eq('participant_phone_hash', session.phoneHash)
      .maybeSingle();

    const share = shareData as ShareRow | null;
    if (!share) return NextResponse.json({ error: 'You have no share on this bill' }, { status: 403 });
    if (share.status === 'paid') {
      return NextResponse.json({ error: 'Your share is already paid' }, { status: 409 });
    }

    const { data: payerWallet } = await supabase
      .from('wallets')
      .select('address')
      .eq('user_id', session.userId)
      .eq('chain_id', CHAIN_ID)
      .maybeSingle();

    if (!payerWallet?.address) {
      return NextResponse.json({ error: 'No wallet for this session' }, { status: 400 });
    }

    const receipt = await getProvider().getTransactionReceipt(txHash);
    if (!receipt) return NextResponse.json({ error: 'Transaction not found yet' }, { status: 404 });
    if (receipt.status !== 1) {
      return NextResponse.json({ error: 'Payment transaction reverted' }, { status: 400 });
    }

    const tokenAddress = getUsdcAddress().toLowerCase();
    const log = receipt.logs.find(
      (entry) => entry.address.toLowerCase() === tokenAddress && entry.topics[0] === TRANSFER_TOPIC
    );
    const parsed = log ? ERC20_INTERFACE.parseLog({ topics: [...log.topics], data: log.data }) : null;
    if (!parsed) {
      return NextResponse.json({ error: 'No USDC transfer in this transaction' }, { status: 400 });
    }

    const from = String(parsed.args[0]).toLowerCase();
    const to = String(parsed.args[1]).toLowerCase();
    const paid = BigInt(parsed.args[2]);

    if (from !== payerWallet.address.toLowerCase()) {
      return NextResponse.json({ error: 'That payment was not sent by your wallet' }, { status: 403 });
    }
    if (to !== bill.creator_address.toLowerCase()) {
      return NextResponse.json({ error: 'That payment did not go to this bill' }, { status: 400 });
    }
    if (paid < BigInt(share.amount)) {
      return NextResponse.json({ error: 'Amount is less than your share' }, { status: 400 });
    }

    // Only a pending share flips to paid, so one transfer cannot settle a share twice.
    const { data: settled } = await supabase
      .from('split_bill_shares')
      .update({
        status: 'paid',
        paid_tx_hash: txHash.toLowerCase(),
        paid_at: new Date().toISOString(),
        participant_user_id: session.userId,
      })
      .eq('id', share.id)
      .eq('status', 'pending')
      .select('id')
      .maybeSingle();

    if (!settled) {
      return NextResponse.json({ error: 'Your share is already paid' }, { status: 409 });
    }

    const { error: txError } = await supabase.from('transactions').insert({
      tx_hash: txHash.toLowerCase(),
      chain_id: CHAIN_ID,
      type: 'transfer',
      status: 'confirmed',
      from_address: from,
      to_address: to,
      token_address: tokenAddress,
      amount: paid.toString(),
      user_id: session.userId,
      counterparty_user_id: bill.creator_id,
      block_number: receipt.blockNumber,
    });
    if (txError && txError.code !== '23505') throw txError;

    // Everyone paid closes the bill.
    const { data: remaining } = await supabase
      .from('split_bill_shares')
      .select('id')
      .eq('bill_id', id)
      .neq('status', 'paid');

    if ((remaining ?? []).length === 0) {
      await supabase.from('split_bills').update({ status: 'settled' }).eq('id', id);
    }

    await supabase.from('notifications').insert({
      user_id: bill.creator_id,
      type: 'transfer_received',
      message: `A share of "${bill.title}" was paid.`,
      metadata: { bill_id: id, tx_hash: txHash.toLowerCase() },
    });

    return NextResponse.json({
      success: true,
      amount: formatUnits(paid, USDC_DECIMALS),
      billSettled: (remaining ?? []).length === 0,
    });
  } catch (error) {
    const { message, isSchemaDrift, code } = describeDbError(error, 'Could not record the payment');
    console.error('[split-bill/pay]', code ?? '', message);
    return NextResponse.json({ error: message, schemaOutOfDate: isSchemaDrift || undefined }, { status: 500 });
  }
}
