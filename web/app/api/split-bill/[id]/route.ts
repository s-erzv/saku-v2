/**
 * One bill: who owes what (GET), and filing a paid share (POST).
 *
 * Paying through Saku is an ordinary transfer from the participant to the bill's creator, signed
 * on the participant's device. This route only records it — and, as everywhere else, records it
 * from the on-chain receipt rather than from what the caller claims to have sent.
 *
 * A share can also be settled *outside* Saku (cash, another bank app). That path is deliberately
 * a different shape: no receipt to verify, so it is stored as what it is — one participant's
 * claim, labelled `external`, with their note, visible to the creator who can dispute it. It
 * moves no money and files no `transactions` row, because none happened here.
 */

import { NextResponse } from 'next/server';
import { Interface, formatUnits, id as keccakId, parseUnits } from 'ethers';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { verifyToken, extractTokenFromHeader } from '@/lib/jwt';
import { transferFee } from '@/lib/fees';
import { recordTransaction } from '@/lib/record-transaction';
import { sendPushNotification } from '@/lib/push';
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
  breakdown: unknown;
}

interface ShareRow {
  id: string;
  participant_phone_hash: string;
  participant_user_id: string | null;
  label: string | null;
  amount: string;
  status: string;
  paid_tx_hash: string | null;
  breakdown: unknown;
  payment_method: string | null;
  payment_note: string | null;
}

/** Everyone paid closes the bill. Returns whether it did, for the response. */
async function closeBillIfFullyPaid(billId: string): Promise<boolean> {
  const supabase = getSupabaseAdmin();
  const { data: remaining } = await supabase
    .from('split_bill_shares')
    .select('id')
    .eq('bill_id', billId)
    .neq('status', 'paid');

  const settled = (remaining ?? []).length === 0;
  if (settled) {
    await supabase.from('split_bills').update({ status: 'settled' }).eq('id', billId);
  }
  return settled;
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
      .select('id, creator_id, creator_address, title, total_amount, status, created_at, breakdown')
      .eq('id', id)
      .maybeSingle();

    const bill = billData as BillRow | null;
    if (!bill) return NextResponse.json({ error: 'Bill not found' }, { status: 404 });

    const { data: sharesData } = await supabase
      .from('split_bill_shares')
      .select('id, participant_phone_hash, participant_user_id, label, amount, status, paid_tx_hash, breakdown, payment_method, payment_note')
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
      breakdown: bill.breakdown ?? null,
      myShare: mine
        ? {
            id: mine.id,
            amount: formatUnits(mine.amount, USDC_DECIMALS),
            status: mine.status,
            breakdown: mine.breakdown ?? null,
          }
        : null,
      // Phone hashes are never returned — a label, an amount and a status is all a bill needs
      // to render, and the hash would be a lookup key for someone else's identity.
      shares: shares.map((s) => ({
        id: s.id,
        label: s.label ?? 'Someone',
        amount: formatUnits(s.amount, USDC_DECIMALS),
        status: s.status,
        isMe: s.participant_phone_hash === session.phoneHash,
        breakdown: s.breakdown ?? null,
        // Null on every row written before settling outside Saku existed; those were all
        // on-chain, so the client reads a missing value as 'saku'.
        paymentMethod: s.payment_method,
        paymentNote: s.payment_note,
      })),
      paidCount: shares.filter((s) => s.status === 'paid').length,
    });
  } catch {
    return NextResponse.json({ error: 'Could not load this bill' }, { status: 500 });
  }
}

/**
 * The platform fee this transaction carried, recomputed here from the amount the chain actually
 * moved rather than taken from the request body. The client is told what the fee is; it is not
 * trusted to report what it paid.
 */
function feeFor(amountUnits: bigint): string {
  const amount = Number(formatUnits(amountUnits, USDC_DECIMALS));
  return parseUnits(transferFee(amount).feeUsdc.toFixed(USDC_DECIMALS), USDC_DECIMALS).toString();
}

/** The separate treasury transfer that collected it, kept for tracing. Never trusted as proof. */
function feeHashFrom(body: unknown): string | null {
  const hash = (body as { feeTxHash?: unknown })?.feeTxHash;
  return typeof hash === 'string' && /^0x[0-9a-fA-F]{64}$/.test(hash) ? hash.toLowerCase() : null;
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession(request);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { id } = await params;

  try {
    const body = await request.json();
    // Two ways to settle a share, and they are not the same claim. 'saku' is proved by a receipt
    // this route reads off-chain itself; 'external' is the participant asserting they paid some
    // other way, which nothing here can verify and so is stored as an assertion, attributed.
    const external = body.method === 'external';
    const txHash = String(body.txHash ?? '');

    if (!external && !TX_HASH.test(txHash)) {
      return NextResponse.json({ error: 'Invalid transaction hash' }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();

    const { data: billData } = await supabase
      .from('split_bills')
      .select('id, creator_id, creator_address, title, total_amount, status, created_at, breakdown')
      .eq('id', id)
      .maybeSingle();

    const bill = billData as BillRow | null;
    if (!bill) return NextResponse.json({ error: 'Bill not found' }, { status: 404 });

    const { data: shareData } = await supabase
      .from('split_bill_shares')
      .select('id, participant_phone_hash, participant_user_id, label, amount, status, paid_tx_hash, breakdown, payment_method, payment_note')
      .eq('bill_id', id)
      .eq('participant_phone_hash', session.phoneHash)
      .maybeSingle();

    const share = shareData as ShareRow | null;
    if (!share) return NextResponse.json({ error: 'You have no share on this bill' }, { status: 403 });
    if (share.status === 'paid') {
      return NextResponse.json({ error: 'Your share is already paid' }, { status: 409 });
    }

    if (external) {
      const note = typeof body.note === 'string' ? body.note.trim().slice(0, 200) : '';

      const { data: markedExternal } = await supabase
        .from('split_bill_shares')
        .update({
          status: 'paid',
          paid_at: new Date().toISOString(),
          participant_user_id: session.userId,
          payment_method: 'external',
          payment_note: note || null,
        })
        .eq('id', share.id)
        .eq('status', 'pending')
        .select('id')
        .maybeSingle();

      if (!markedExternal) {
        return NextResponse.json({ error: 'Your share is already paid' }, { status: 409 });
      }

      await closeBillIfFullyPaid(id);

      // No `transactions` row: nothing moved on-chain, and history is a mirror of the chain.
      // The creator still needs to know, so the notification is the same shape as the on-chain
      // one with the method spelled out.
      const notification = {
        userId: bill.creator_id,
        type: 'system',
        message: `A share of "${bill.title}" was marked paid outside Saku.`,
        metadata: {
          bill_id: id,
          amount: share.amount,
          title: bill.title,
          counterparty_user_id: session.userId,
          payment_method: 'external',
          note: note || null,
        },
      };

      await supabase.from('notifications').insert({
        user_id: notification.userId,
        type: notification.type,
        message: notification.message,
        metadata: notification.metadata,
      });

      return NextResponse.json({
        success: true,
        amount: formatUnits(share.amount, USDC_DECIMALS),
        external: true,
      });
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

    await recordTransaction(supabase, {
      tx_hash: txHash.toLowerCase(),
      chain_id: CHAIN_ID,
      type: 'transfer',
      status: 'confirmed',
      from_address: from,
      to_address: to,
      token_address: tokenAddress,
      amount: paid.toString(),
      fee_amount: feeFor(paid),
      fee_tx_hash: feeHashFrom(body),
      user_id: session.userId,
      counterparty_user_id: bill.creator_id,
      block_number: receipt.blockNumber,
      context: { kind: 'split_bill', title: bill.title },
    });

    const billSettled = await closeBillIfFullyPaid(id);

    const notification = {
      userId: bill.creator_id,
      type: 'transfer_received',
      message: `A share of "${bill.title}" was paid.`,
      metadata: {
        bill_id: id,
        tx_hash: txHash.toLowerCase(),
        amount: paid.toString(),
        title: bill.title,
        counterparty_user_id: session.userId,
      },
    };

    await supabase.from('notifications').insert({
      user_id: notification.userId,
      type: notification.type,
      message: notification.message,
      metadata: notification.metadata,
    });

    await sendPushNotification(notification);

    return NextResponse.json({
      success: true,
      amount: formatUnits(paid, USDC_DECIMALS),
      billSettled,
    });
  } catch (error) {
    const { message, isSchemaDrift, code } = describeDbError(error, 'Could not record the payment');
    console.error('[split-bill/pay]', code ?? '', message);
    return NextResponse.json({ error: message, schemaOutOfDate: isSchemaDrift || undefined }, { status: 500 });
  }
}
