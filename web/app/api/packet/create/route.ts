/**
 * Create a packet from a transfer the sender already made.
 *
 * The sender funds first and creates second: they sign a normal USDC transfer into the settler
 * treasury, then post that hash here. The packet's total comes off the receipt, so a packet can
 * never exist without the money behind it, and the amount is never a number the client asserted.
 *
 * This is the one custodial window in v2 — see the note on `packets` in the schema. The funding
 * hash is stored so the whole of it stays auditable on-chain.
 */

import { NextResponse } from 'next/server';
import { Interface, id as keccakId } from 'ethers';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { verifyToken, extractTokenFromHeader } from '@/lib/jwt';
import { CHAIN_ID, getProvider, getSettler, getUsdcAddress } from '@/lib/chain';
import { generatePacketCode, isSplitMode, MAX_SLOTS } from '@/lib/packet';
import { hashPhone } from '@/lib/phone';
import { describeDbError } from '@/lib/db-errors';

const TX_HASH = /^0x[0-9a-fA-F]{64}$/;
const TRANSFER_TOPIC = keccakId('Transfer(address,address,uint256)');
const ERC20_INTERFACE = new Interface([
  'event Transfer(address indexed from, address indexed to, uint256 value)',
]);

/** A packet left unclaimed this long is refundable to its creator. */
const EXPIRY_HOURS = 72;

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
    const slots = Number(body.slots);
    const splitMode = body.splitMode ?? 'equal';

    if (!TX_HASH.test(txHash)) {
      return NextResponse.json({ error: 'Invalid transaction hash' }, { status: 400 });
    }
    if (!Number.isInteger(slots) || slots < 1 || slots > MAX_SLOTS) {
      return NextResponse.json({ error: `Slots must be between 1 and ${MAX_SLOTS}` }, { status: 400 });
    }
    if (!isSplitMode(splitMode)) {
      return NextResponse.json({ error: 'Unknown split mode' }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();

    const { data: wallet } = await supabase
      .from('wallets')
      .select('address')
      .eq('user_id', session.userId)
      .eq('chain_id', CHAIN_ID)
      .maybeSingle();

    if (!wallet?.address) {
      return NextResponse.json({ error: 'No wallet for this session' }, { status: 400 });
    }

    // Already used? A funding transfer backs exactly one packet.
    const { data: taken } = await supabase
      .from('packets')
      .select('code')
      .eq('funding_tx_hash', txHash.toLowerCase())
      .maybeSingle();

    if (taken) {
      return NextResponse.json({ error: 'That transfer already funds a packet' }, { status: 409 });
    }

    const receipt = await getProvider().getTransactionReceipt(txHash);
    if (!receipt) return NextResponse.json({ error: 'Transaction not found yet' }, { status: 404 });
    if (receipt.status !== 1) {
      return NextResponse.json({ error: 'Funding transaction reverted' }, { status: 400 });
    }

    const tokenAddress = getUsdcAddress().toLowerCase();
    const treasury = getSettler().address.toLowerCase();

    // The transfer must be from this session's wallet, into the treasury, in USDC. Anything
    // else — someone else's transfer, a different token, a different destination — is not a
    // packet funding.
    const log = receipt.logs.find(
      (entry) => entry.address.toLowerCase() === tokenAddress && entry.topics[0] === TRANSFER_TOPIC
    );
    const parsed = log
      ? ERC20_INTERFACE.parseLog({ topics: [...log.topics], data: log.data })
      : null;

    if (!parsed) {
      return NextResponse.json({ error: 'No USDC transfer in this transaction' }, { status: 400 });
    }

    const from = String(parsed.args[0]).toLowerCase();
    const to = String(parsed.args[1]).toLowerCase();
    const amount = BigInt(parsed.args[2]);

    if (from !== wallet.address.toLowerCase()) {
      return NextResponse.json({ error: 'That transfer was not sent by your wallet' }, { status: 403 });
    }
    if (to !== treasury) {
      return NextResponse.json({ error: 'That transfer did not fund a packet' }, { status: 400 });
    }
    // Every claimer must be payable at least one base unit.
    if (amount < BigInt(slots)) {
      return NextResponse.json({ error: 'Amount is too small for that many slots' }, { status: 400 });
    }

    // Private mode: restrict to specific numbers, stored as hashes only (v1 kept plain numbers).
    let restricted: string[] | null = null;
    if (Array.isArray(body.restrictedTo) && body.restrictedTo.length > 0) {
      try {
        restricted = body.restrictedTo
          .slice(0, MAX_SLOTS)
          .map((phone: string) => hashPhone(phone, body.countryCode || '62'));
      } catch {
        return NextResponse.json({ error: 'One of the numbers is invalid' }, { status: 400 });
      }
    }

    const code = generatePacketCode();

    const { data: packet, error } = await supabase
      .from('packets')
      .insert({
        code,
        creator_id: session.userId,
        total_amount: amount.toString(),
        token_address: tokenAddress,
        slots,
        split_mode: splitMode,
        theme: typeof body.theme === 'string' ? body.theme.slice(0, 32) : null,
        message: typeof body.message === 'string' ? body.message.slice(0, 140) : null,
        restricted_to_hashes: restricted,
        funding_tx_hash: txHash.toLowerCase(),
        // Funded and verified in the same request, so it opens immediately.
        status: 'open',
        expires_at: new Date(Date.now() + EXPIRY_HOURS * 3_600_000).toISOString(),
      })
      .select('code, total_amount, slots, split_mode, expires_at')
      .single();

    if (error) throw error;

    await supabase.from('transactions').insert({
      tx_hash: txHash.toLowerCase(),
      chain_id: CHAIN_ID,
      type: 'transfer',
      status: 'confirmed',
      from_address: from,
      to_address: to,
      token_address: tokenAddress,
      amount: amount.toString(),
      user_id: session.userId,
      block_number: receipt.blockNumber,
    });

    return NextResponse.json({ success: true, packet });
  } catch (error) {
    const { message, isSchemaDrift, code } = describeDbError(error, 'Could not create the packet');
    console.error('[packet/create]', code ?? '', message);
    return NextResponse.json({ error: message, schemaOutOfDate: isSchemaDrift || undefined }, { status: 500 });
  }
}
