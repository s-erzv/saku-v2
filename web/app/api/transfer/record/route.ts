/**
 * Record a completed transfer in the history cache and notify the recipient.
 *
 * The client sends a transaction hash, not an amount to be believed. Everything written here is
 * read back off-chain from the receipt: a caller who POSTs someone else's hash, a fabricated
 * amount, or a hash that never moved tokens gets nothing written. The chain is the source of
 * truth (the `transactions` table comment says as much); this route only mirrors it.
 */

import { NextResponse } from 'next/server';
import { Interface, id as keccakId } from 'ethers';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { verifyToken, extractTokenFromHeader } from '@/lib/jwt';
import { CHAIN_ID, getProvider, getUsdcAddress } from '@/lib/chain';

const TRANSFER_TOPIC = keccakId('Transfer(address,address,uint256)');
const ERC20_INTERFACE = new Interface([
  'event Transfer(address indexed from, address indexed to, uint256 value)',
]);

const TX_HASH = /^0x[0-9a-fA-F]{64}$/;

export async function POST(request: Request) {
  const sessionToken = extractTokenFromHeader(request.headers.get('authorization'));
  if (!sessionToken) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let session;
  try {
    session = await verifyToken(sessionToken);
  } catch {
    return NextResponse.json({ error: 'Invalid or expired session' }, { status: 401 });
  }

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
    const { error: insertError } = await supabase.from('transactions').insert({
      tx_hash: txHash.toLowerCase(),
      chain_id: CHAIN_ID,
      type: 'transfer',
      status: 'confirmed',
      from_address: from,
      to_address: to,
      token_address: tokenAddress,
      amount: value,
      user_id: session.userId,
      counterparty_user_id: recipientWallet?.user_id ?? null,
      block_number: receipt.blockNumber,
    });

    if (insertError && insertError.code !== '23505') throw insertError;

    if (!insertError && recipientWallet?.user_id) {
      await supabase.from('notifications').insert({
        user_id: recipientWallet.user_id,
        type: 'transfer_received',
        message: 'You received USDC.',
        metadata: { tx_hash: txHash.toLowerCase(), amount: value },
      });
    }

    return NextResponse.json({ success: true, from, to, amount: value });
  } catch {
    return NextResponse.json({ error: 'Could not record the transaction' }, { status: 500 });
  }
}
