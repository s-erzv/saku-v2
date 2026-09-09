/**
 * Read a payment request (GET) and record its payment (POST).
 *
 * The payer signs the transfer themselves, so POST is not what moves the money — it is the
 * receipt being filed afterwards. As everywhere else, the amount and the parties come off the
 * on-chain log rather than from the request body: a caller cannot mark someone else's request
 * paid, or claim an amount the chain did not see.
 */

import { NextResponse } from 'next/server';
import { Interface, formatUnits, id as keccakId, parseUnits } from 'ethers';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { getSession, unauthorized } from '@/lib/session';
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

interface RequestRow {
  id: string;
  code: string;
  payee_id: string;
  payee_address: string;
  amount: string | null;
  note: string | null;
  status: string;
  expires_at: string;
}

const requireSession = getSession;

async function loadRequest(code: string): Promise<RequestRow | null> {
  const supabase = getSupabaseAdmin();
  const { data } = await supabase
    .from('payment_requests')
    .select('id, code, payee_id, payee_address, amount, note, status, expires_at')
    .eq('code', code.toUpperCase())
    .maybeSingle();

  return (data as RequestRow | null) ?? null;
}

export async function GET(request: Request, { params }: { params: Promise<{ code: string }> }) {
  const session = await requireSession(request);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { code } = await params;

  try {
    const row = await loadRequest(code);
    if (!row) return NextResponse.json({ error: 'Request not found' }, { status: 404 });

    const supabase = getSupabaseAdmin();
    const { data: payee } = await supabase
      .from('users')
      .select('display_name')
      .eq('id', row.payee_id)
      .maybeSingle();

    const expired = new Date(row.expires_at).getTime() < Date.now();

    return NextResponse.json({
      code: row.code,
      payeeName: payee?.display_name ?? 'Saku user',
      payeeAddress: row.payee_address,
      amount: row.amount ? formatUnits(row.amount, USDC_DECIMALS) : null,
      note: row.note,
      status: expired && row.status === 'open' ? 'expired' : row.status,
      isPayee: row.payee_id === session.userId,
      payable: row.status === 'open' && !expired && row.payee_id !== session.userId,
    });
  } catch {
    return NextResponse.json({ error: 'Could not load this request' }, { status: 500 });
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

export async function POST(request: Request, { params }: { params: Promise<{ code: string }> }) {
  const session = await requireSession(request);
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { code } = await params;

  try {
    const body = await request.json();
    const txHash = String(body.txHash ?? '');
    if (!TX_HASH.test(txHash)) {
      return NextResponse.json({ error: 'Invalid transaction hash' }, { status: 400 });
    }

    const row = await loadRequest(code);
    if (!row) return NextResponse.json({ error: 'Request not found' }, { status: 404 });

    const supabase = getSupabaseAdmin();

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
    if (to !== row.payee_address.toLowerCase()) {
      return NextResponse.json({ error: 'That payment did not go to this request' }, { status: 400 });
    }
    // A fixed-amount request must be paid in full. Overpaying is allowed — refusing it would
    // reject money that has already moved on-chain and cannot be un-sent.
    if (row.amount && paid < BigInt(row.amount)) {
      return NextResponse.json({ error: 'Amount is less than requested' }, { status: 400 });
    }

    // Only an open request flips to paid. A second submission finds nothing to update, which is
    // what stops one transfer from being filed against a request twice.
    const { data: claimed } = await supabase
      .from('payment_requests')
      .update({
        status: 'paid',
        payer_id: session.userId,
        paid_amount: paid.toString(),
        paid_tx_hash: txHash.toLowerCase(),
        paid_at: new Date().toISOString(),
      })
      .eq('id', row.id)
      .eq('status', 'open')
      .select('id')
      .maybeSingle();

    if (!claimed) {
      return NextResponse.json({ error: 'This request is no longer open' }, { status: 409 });
    }

    await recordTransaction(supabase, {
      tx_hash: txHash.toLowerCase(),
      chain_id: CHAIN_ID,
      type: 'qr_payment',
      status: 'confirmed',
      from_address: from,
      to_address: to,
      token_address: tokenAddress,
      amount: paid.toString(),
      fee_amount: feeFor(paid),
      fee_tx_hash: feeHashFrom(body),
      user_id: session.userId,
      counterparty_user_id: row.payee_id,
      block_number: receipt.blockNumber,
    });

    const notification = {
      userId: row.payee_id as string,
      type: 'transfer_received',
      message: 'Your QR payment was paid.',
      metadata: {
        code: row.code,
        tx_hash: txHash.toLowerCase(),
        amount: paid.toString(),
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
      txHash,
    });
  } catch (error) {
    const { message, isSchemaDrift, code: dbCode } = describeDbError(error, 'Could not record the payment');
    console.error('[qr-payment/pay]', dbCode ?? '', message);
    return NextResponse.json({ error: message, schemaOutOfDate: isSchemaDrift || undefined }, { status: 500 });
  }
}
