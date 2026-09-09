/**
 * Record a completed transfer in the history cache and notify the recipient.
 *
 * The client sends a transaction hash, not an amount to be believed. Everything written here is
 * read back off-chain from the receipt: a caller who POSTs someone else's hash, a fabricated
 * amount, or a hash that never moved tokens gets nothing written. The chain is the source of
 * truth (the `transactions` table comment says as much); this route only mirrors it.
 */

import { NextResponse } from 'next/server';
import { Interface, formatUnits, id as keccakId, parseUnits } from 'ethers';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { getSession, unauthorized } from '@/lib/session';
import { transferFee } from '@/lib/fees';
import { recordTransaction } from '@/lib/record-transaction';
import { CHAIN_ID, USDC_DECIMALS, getProvider, getUsdcAddress } from '@/lib/chain';
import { sendPushNotification } from '@/lib/push';

const TRANSFER_TOPIC = keccakId('Transfer(address,address,uint256)');
const ERC20_INTERFACE = new Interface([
  'event Transfer(address indexed from, address indexed to, uint256 value)',
]);

const TX_HASH = /^0x[0-9a-fA-F]{64}$/;

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

export async function POST(request: Request) {
  const session = await getSession(request);
  if (!session) return unauthorized();

  try {
    const body = await request.json();
    const txHash = String(body.txHash ?? '');
    if (!TX_HASH.test(txHash)) {
      return NextResponse.json({ error: 'Invalid transaction hash' }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();

    // The sender must be the caller's own wallet — otherwise anyone could file someone else's
    // transfer as their own history.
    const { data: senderWallet } = await supabase
      .from('wallets')
      .select('address')
      .eq('user_id', session.userId)
      .eq('chain_id', CHAIN_ID)
      .maybeSingle();

    if (!senderWallet?.address) {
      return NextResponse.json({ error: 'No wallet for this session' }, { status: 400 });
    }

    const receipt = await getProvider().getTransactionReceipt(txHash);
    if (!receipt) return NextResponse.json({ error: 'Transaction not found yet' }, { status: 404 });
    if (receipt.status !== 1) {
      return NextResponse.json({ error: 'Transaction reverted on-chain' }, { status: 400 });
    }

    const tokenAddress = getUsdcAddress().toLowerCase();

    // Find the ERC20 Transfer log that actually came from this session's wallet.
    const log = receipt.logs.find(
      (entry) =>
        entry.address.toLowerCase() === tokenAddress &&
        entry.topics[0] === TRANSFER_TOPIC &&
        entry.topics.length === 3
    );
    if (!log) {
      return NextResponse.json({ error: 'No token transfer in this transaction' }, { status: 400 });
    }

    const parsed = ERC20_INTERFACE.parseLog({ topics: [...log.topics], data: log.data });
    if (!parsed) {
      return NextResponse.json({ error: 'Unreadable transfer log' }, { status: 400 });
    }

    const from = String(parsed.args[0]).toLowerCase();
    const to = String(parsed.args[1]).toLowerCase();
    const value = BigInt(parsed.args[2]).toString();

    if (from !== senderWallet.address.toLowerCase()) {
      return NextResponse.json({ error: 'This transfer was not sent by your wallet' }, { status: 403 });
    }

    // Who received it, if they are on Saku. A transfer to an address outside Saku still gets
    // recorded for the sender — it happened — just without a counterparty.
    const { data: recipientWallet } = await supabase
      .from('wallets')
      .select('user_id')
      .eq('address', to)
      .eq('chain_id', CHAIN_ID)
      .maybeSingle();

    // `transactions` is unique per (chain_id, tx_hash), so a double submit collides instead of
    // duplicating. Treat that as success — the row it wanted is already there.
    const record = await recordTransaction(supabase, {
      tx_hash: txHash.toLowerCase(),
      chain_id: CHAIN_ID,
      type: 'transfer',
      status: 'confirmed',
      from_address: from,
      to_address: to,
      token_address: tokenAddress,
      amount: value,
      fee_amount: feeFor(BigInt(value)),
      fee_tx_hash: feeHashFrom(body),
      user_id: session.userId,
      counterparty_user_id: recipientWallet?.user_id ?? null,
      block_number: receipt.blockNumber,
    });


    // Skipped on a resubmit: the recipient was already told the first time round.
    if (!record.duplicate && recipientWallet?.user_id) {
      // No `display_name` lookup here on purpose: the sentence is composed at read time
      // (`lib/notification-copy.ts`), so the id is what needs storing, not the name it had
      // on the day the transfer happened.
      const notification = {
        userId: recipientWallet.user_id as string,
        type: 'transfer_received',
        message: 'You received USDC.',
        metadata: {
          tx_hash: txHash.toLowerCase(),
          amount: value,
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
    }

    return NextResponse.json({ success: true, from, to, amount: value });
  } catch {
    return NextResponse.json({ error: 'Could not record the transaction' }, { status: 500 });
  }
}
