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
import { Interface, formatUnits, id as keccakId, parseUnits } from 'ethers';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { getSession, unauthorized } from '@/lib/session';
import { transferFee } from '@/lib/fees';
import { recordTransaction } from '@/lib/record-transaction';
import { CHAIN_ID, USDC_DECIMALS, getProvider, getSettler, getUsdcAddress } from '@/lib/chain';
import { generatePacketCode, isSplitMode, MAX_SLOTS } from '@/lib/packet';
import { hashPhone } from '@/lib/phone';
import { describeDbError } from '@/lib/db-errors';

const TX_HASH = /^0x[0-9a-fA-F]{64}$/;
/** `lib/phone.ts` emits keccak256 hex; anything else was not produced by this app. */
const PHONE_HASH = /^0x[0-9a-fA-F]{64}$/;

/** `packets.message` after the 2026-09-09 letter migration; a note, not a caption. */
const MAX_MESSAGE = 600;
/** What the column allowed before it — see the retry below. */
const LEGACY_MAX_MESSAGE = 140;
const TRANSFER_TOPIC = keccakId('Transfer(address,address,uint256)');
const ERC20_INTERFACE = new Interface([
  'event Transfer(address indexed from, address indexed to, uint256 value)',
]);

/** A packet left unclaimed this long is refundable to its creator. */
/**
 * How long a packet stays claimable. The sender picks one; anything else is rejected rather
 * than clamped, so a client sending nonsense finds out instead of silently getting 3 days.
 * `null` means no deadline.
 */
const EXPIRY_CHOICES = [24, 72, 168, 720] as const;
const LONGEST_EXPIRY_HOURS = 720;
const DEFAULT_EXPIRY_HOURS = 72;

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
    //
    // Two ways in, because the client has two kinds of recipient. A number typed by hand arrives
    // as `restrictedTo` and is hashed here. A saved contact arrives as `restrictedToHashes` —
    // the address book only holds a label and a hash server-side (see `hooks/useContacts.ts`),
    // and the number itself lives in one device's cache, so requiring a number would make
    // contacts unusable for this on every device except the one that saved them.
    let restricted: string[] | null = null;

    if (Array.isArray(body.restrictedToHashes) && body.restrictedToHashes.length > 0) {
      const hashes = body.restrictedToHashes
        .slice(0, MAX_SLOTS)
        .filter((hash: unknown): hash is string => typeof hash === 'string' && PHONE_HASH.test(hash));

      if (hashes.length !== Math.min(body.restrictedToHashes.length, MAX_SLOTS)) {
        return NextResponse.json({ error: 'One of the contacts is invalid' }, { status: 400 });
      }
      restricted = hashes;
    }

    if (Array.isArray(body.restrictedTo) && body.restrictedTo.length > 0) {
      try {
        const hashed = body.restrictedTo
          .slice(0, MAX_SLOTS)
          .map((phone: string) => hashPhone(phone, body.countryCode || '62'));
        restricted = [...new Set([...(restricted ?? []), ...hashed])];
      } catch {
        return NextResponse.json({ error: 'One of the numbers is invalid' }, { status: 400 });
      }
    }

    // A private packet nobody can open is a funded packet with no way out but expiry.
    if (restricted && restricted.length === 0) {
      return NextResponse.json({ error: 'Pick at least one person for a private packet' }, { status: 400 });
    }

    // Expiry: one of the offered windows, or explicitly never.
    let expiresAt: string | null;
    if (body.expiresInHours === null) {
      expiresAt = null;
    } else {
      const hours = body.expiresInHours === undefined ? DEFAULT_EXPIRY_HOURS : Number(body.expiresInHours);
      if (!EXPIRY_CHOICES.includes(hours as (typeof EXPIRY_CHOICES)[number])) {
        return NextResponse.json({ error: 'Invalid expiry' }, { status: 400 });
      }
      expiresAt = new Date(Date.now() + hours * 3_600_000).toISOString();
    }

    const code = generatePacketCode();

    const letter = typeof body.message === 'string' ? body.message.slice(0, MAX_MESSAGE) : null;

    function packetRow(message: string | null, expires: string | null) {
      return {
        code,
        creator_id: session!.userId,
        total_amount: amount.toString(),
        token_address: tokenAddress,
        slots,
        split_mode: splitMode,
        theme: typeof body.theme === 'string' ? body.theme.slice(0, 32) : null,
        message,
        restricted_to_hashes: restricted,
        funding_tx_hash: txHash.toLowerCase(),
        // Funded and verified in the same request, so it opens immediately.
        status: 'open',
        expires_at: expires,
      };
    }

    const SELECT = 'code, total_amount, slots, split_mode, expires_at';
    let { data: packet, error } = await supabase
      .from('packets')
      .insert(packetRow(letter, expiresAt))
      .select(SELECT)
      .single();

    /**
     * The money is already in the treasury by the time this runs — the transfer happened before
     * this request — so a failed insert means a funded packet that does not exist. That is not
     * an acceptable outcome for a schema that is merely behind.
     *
     * Two migrations can be pending, and both are degradable:
     *   23514 — the pre-2026-09-09 140-character cap on `message`: save a shortened note.
     *   23502 — `expires_at` still NOT NULL: use the longest window on offer instead of never.
     *
     * Both are visible to the sender on the confirmation screen, which prints the real expiry
     * and the note as saved, so neither degrades silently.
     */
    if (error?.code === '23514' || error?.code === '23502') {
      const fallbackLetter =
        error.code === '23514' && letter && letter.length > LEGACY_MAX_MESSAGE
          ? `${letter.slice(0, LEGACY_MAX_MESSAGE - 1)}…`
          : letter;
      const fallbackExpiry =
        error.code === '23502' && expiresAt === null
          ? new Date(Date.now() + LONGEST_EXPIRY_HOURS * 3_600_000).toISOString()
          : expiresAt;

      if (fallbackLetter !== letter || fallbackExpiry !== expiresAt) {
        console.warn(`[packet/create] schema behind (${error.code}); saving a degraded packet`);
        ({ data: packet, error } = await supabase
          .from('packets')
          .insert(packetRow(fallbackLetter, fallbackExpiry))
          .select(SELECT)
          .single());
      }
    }

    if (error) throw error;
    // `.single()` gives `data: null` only alongside an error, which the line above rethrows —
    // this narrows the type for everything below.
    if (!packet) throw new Error('packet insert returned no row');

    await recordTransaction(supabase, {
      tx_hash: txHash.toLowerCase(),
      chain_id: CHAIN_ID,
      type: 'transfer',
      status: 'confirmed',
      from_address: from,
      to_address: to,
      token_address: tokenAddress,
      amount: amount.toString(),
      fee_amount: feeFor(amount),
      fee_tx_hash: feeHashFrom(body),
      user_id: session.userId,
      block_number: receipt.blockNumber,
      // What this transfer was for. Without it history reads "Transfer −50.00" for a packet
      // sent to five people — true, and no use to anyone.
      context: { kind: 'packet_send', code: packet.code, slots: packet.slots },
    });

    return NextResponse.json({ success: true, packet });
  } catch (error) {
    const { message, isSchemaDrift, code } = describeDbError(error, 'Could not create the packet');
    console.error('[packet/create]', code ?? '', message);
    return NextResponse.json({ error: message, schemaOutOfDate: isSchemaDrift || undefined }, { status: 500 });
  }
}
