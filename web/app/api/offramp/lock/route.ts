/**
 * Observe a lock the user just signed, then settle it — PRD 5.1 steps 5 through 9.
 *
 * The client sends a transaction hash, never an amount or a request id. Everything recorded here
 * is parsed out of the `OfframpRequested` event in that transaction's receipt, so a caller
 * cannot file a request for funds they did not lock, nor claim a different amount than the one
 * the contract saw.
 *
 * Settlement runs after the response is sent, not before it. It used to run inline, which meant
 * a browser sat on one HTTP request through three sequential on-chain confirmations (approve,
 * lock, swap) plus a Xendit call — the slowest part of the whole flow, and none of it something
 * the user's own signature was still needed for past the lock. `waitUntil` (Vercel's primitive
 * for exactly this — finish work after responding, without the platform tearing the function
 * down first) lets the response return the moment the lock is recorded, while settlement keeps
 * running in the background. The client learns the outcome by polling `/api/offramp/[requestId]`
 * (GET), which already existed for this.
 *
 * Nothing about failure handling changed. `lockForOfframp` fixes a deadline 120 seconds out and
 * `settleOfframp` reverts past it; if settlement fails for any reason, the row simply never
 * leaves `status: 'locked'`, and `refund()` on the escrow is callable by anyone once that
 * deadline passes — the PRD Section 5.3 state-desync mitigation, running exactly as it did
 * before, just no longer blocking the HTTP response.
 */

import { NextResponse } from 'next/server';
import { waitUntil } from '@vercel/functions';
import { formatUnits, parseUnits } from 'ethers';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { getSession, unauthorized } from '@/lib/session';
import { CHAIN_ID, getProvider, getUsdcAddress } from '@/lib/chain';
import {
  getEscrowAddress,
  getEscrowReadOnly,
  getStableTokenAddress,
  settleOfframp,
} from '@/lib/escrow';
import { currencyForCountry } from '@/lib/currency';
import { getUsdRate } from '@/lib/fx';
import { getCompliancePolicy, isOfframpAllowed, isPartnerAllowed, offrampDisabledMessage } from '@/lib/compliance';
import { isRail, mockDisbursement, mockExchange, type Rail } from '@/lib/mock-fiat';
import { sendPushNotification } from '@/lib/push';
import { offrampFee } from '@/lib/fees';
import { disbursementChannelFor, sendBankDisbursement, sendWalletDisbursement } from '@/lib/xendit-disbursement';
import { hashPhone, InvalidPhoneNumberError } from '@/lib/phone';
import { hashBankRecipient } from '@/lib/bank-recipient';
import { describeDbError } from '@/lib/db-errors';

const TX_HASH = /^0x[0-9a-fA-F]{64}$/;
const STABLE_DECIMALS = 18;

interface DisbursementOutcome {
  reference: string;
  simulated: boolean;
}

/**
 * Try a real payout — e-wallet or bank — and fall back to the simulated one whenever a real
 * payout is not possible or does not succeed.
 *
 * "Not possible" covers the client not sending the destination details a real payout needs
 * (older clients, or the recipient-resolution step being skipped). "Does not succeed" covers
 * Xendit rejecting the call — insufficient balance, an unreachable wallet, a bank's name
 * validation rejecting Saku's generic account-holder placeholder, anything else. A fiat-leg
 * failure must never undo or fail the settlement: the on-chain lock and swap already happened,
 * and that money is not going back.
 */
async function settleDisbursement(params: {
  rail: Rail;
  recipientPhone: string | null;
  countryCode: string;
  bankCode: string | null;
  accountNumber: string | null;
  expectedHash: string;
  requestId: string;
  fiatAmount: number;
  /** PRD Section 6: a real payout only ever runs for a partner this country's policy names. */
  partnerAllowed: boolean;
}): Promise<DisbursementOutcome> {
  const channel = params.partnerAllowed ? disbursementChannelFor(params.rail) : null;
  const externalId = `saku-offramp-${params.requestId.slice(2, 18)}`;

  try {
    if (channel && params.recipientPhone) {
      // The phone number is client-supplied, so it is trusted only after it reproduces the same
      // hash the contract stored on-chain — otherwise a caller could redirect a real payout to
      // an arbitrary number while the lock records a different one.
      const actualHash = hashPhone(params.recipientPhone, params.countryCode);
      if (actualHash !== params.expectedHash) {
        throw new Error('Recipient phone does not match the locked request');
      }

      const result = await sendWalletDisbursement(
        externalId,
        params.rail,
        params.recipientPhone.replace(/\D/g, ''),
        params.fiatAmount,
        'Saku cross-rail transfer'
      );
      return { reference: result.id, simulated: false };
    }

    if (params.partnerAllowed && params.rail === 'bank' && params.bankCode && params.accountNumber) {
      // Same verify-before-trust rule as the phone case, just against the bank hash instead.
      const actualHash = hashBankRecipient(params.bankCode, params.accountNumber);
      if (actualHash !== params.expectedHash) {
        throw new Error('Recipient account does not match the locked request');
      }

      const result = await sendBankDisbursement(
        externalId,
        params.bankCode,
        params.accountNumber,
        params.fiatAmount,
        'Saku cross-rail transfer'
      );
      return { reference: result.id, simulated: false };
    }
  } catch (error) {
    // Falls through to the simulated path below. Logged so a real, silent payout failure is
    // still visible somewhere other than a user's missing balance.
    console.error('[offramp/disbursement] real payout failed, falling back to simulated:', error instanceof InvalidPhoneNumberError ? 'invalid phone' : error);
  }

  const mock = await mockDisbursement(params.rail, params.expectedHash, params.fiatAmount, 'IDR');
  return { reference: mock.reference, simulated: true };
}

/**
 * Everything that happens after a lock is recorded: the real swap, then the fiat legs. Runs
 * inside `waitUntil`, after the HTTP response for the lock has already gone out — nothing here
 * has a caller waiting synchronously, so failures are recorded to the row for polling to find,
 * never thrown to a response nobody reads.
 */
async function settleInBackground(params: {
  requestId: string;
  token: string;
  amount: bigint;
  /** The delivered/net amount the fee was computed on top of — see `/lib/fees.ts:offrampFee`. */
  netUsdc: number;
  grossUsdc: number;
  deadline: number;
  userId: string;
  rail: Rail;
  recipientPhone: string | null;
  countryCode: string;
  bankCode: string | null;
  accountNumber: string | null;
  recipientPhoneHash: string;
  currency: { code: string };
  fxRate: number;
  policy: Awaited<ReturnType<typeof getCompliancePolicy>>;
}): Promise<void> {
  const supabase = getSupabaseAdmin();
  const { requestId, token, amount, recipientPhoneHash } = params;

  try {
    const { receipt: settleReceipt, amountOut } = await settleOfframp(requestId, token, amount);
    const stableOut = Number(formatUnits(amountOut, STABLE_DECIMALS));

    await supabase
      .from('offramp_requests')
      .update({
        status: 'settled',
        settle_tx_hash: settleReceipt.hash.toLowerCase(),
        stable_amount_out: amountOut.toString(),
        fiat_status: 'converting',
        settled_at: new Date().toISOString(),
      })
      .eq('request_id', requestId);

    // Only the net (delivered) slice of the swap proceeds goes to the recipient — the platform
    // fee was added on top of it when the lock amount was computed, not taken back out of it now.
    const payableStable = stableOut * (params.netUsdc / params.grossUsdc);

    const exchange = await mockExchange(payableStable, params.currency.code, params.fxRate);
    const disbursement = await settleDisbursement({
      rail: params.rail,
      recipientPhone: params.recipientPhone,
      countryCode: params.countryCode,
      bankCode: params.bankCode,
      accountNumber: params.accountNumber,
      expectedHash: recipientPhoneHash,
      requestId,
      fiatAmount: exchange.fiatAmount,
      partnerAllowed: isPartnerAllowed(params.policy, 'xendit'),
    });

    await supabase
      .from('offramp_requests')
      .update({
        fiat_status: 'completed',
        mock_exchange_reference: exchange.reference,
        mock_disbursement_reference: disbursement.reference,
        fiat_amount_idr: exchange.fiatAmount,
      })
      .eq('request_id', requestId);

    // No `transactions` row here on purpose. The `offramp_lock` row already recorded the debit
    // from the user's wallet — that is the one real transfer out, from their point of view. This
    // settle transaction moves the *escrow's* funds through PancakeSwap; it never touches the
    // user's wallet again, so logging it with the same `user_id` and the same amount used to
    // show up as a second, phantom "-2 USDC" in Recent Activity for one transfer. It stays fully
    // auditable via `offramp_requests.settle_tx_hash` and the BscScan link already on the
    // success screen — just not as a second history row implying a second debit.

    const notification = {
      userId: params.userId,
      type: 'offramp_status',
      message: 'Your transfer has been sent.',
      metadata: {
        request_id: requestId,
        settle_tx: settleReceipt.hash.toLowerCase(),
        // The delivered slice, in base units — what the recipient is actually getting, not the
        // gross the fee was added on top of.
        amount: parseUnits(params.netUsdc.toFixed(6), 6).toString(),
        rail: params.rail,
      },
    };

    await supabase.from('notifications').insert({
      user_id: notification.userId,
      type: notification.type,
      message: notification.message,
      metadata: notification.metadata,
    });

    await sendPushNotification(notification);
  } catch (settleError) {
    const reason = settleError instanceof Error ? settleError.message : 'Settlement failed';
    console.error('[offramp/settle] failed, request stays locked and refundable:', reason);

    // Deliberately not thrown further — nobody is waiting on this promise's rejection. The row
    // staying at `status: 'locked'` past `rate_expires_at` is what tells the client (via polling)
    // that this is now a refund, not a pending settlement.
    await supabase
      .from('offramp_requests')
      .update({ failure_reason: reason.slice(0, 500) })
      .eq('request_id', requestId);
  }
}

export async function POST(request: Request) {
  const session = await getSession(request);
  if (!session) return unauthorized();

  try {
    const body = await request.json();
    const txHash = String(body.txHash ?? '');
    const rail = body.rail;
    // Present only for a real e-wallet disbursement (GoPay/OVO/DANA/ShopeePay). Everywhere else
    // in Saku, only a phone *hash* ever reaches the server — this is the one deliberate
    // exception, and it exists for exactly one reason: Xendit's disbursement API needs a real
    // number to pay out to. It is verified against the on-chain hash below and used for a
    // single API call. It is never written to the database.
    const recipientPhone = typeof body.recipientPhone === 'string' ? body.recipientPhone : null;
    const countryCode = typeof body.countryCode === 'string' ? body.countryCode : '62';
    // Present only for the `bank` rail, for the same one reason and the same "never persisted"
    // rule as recipientPhone above — a real bank disbursement needs an account number.
    const bankCode = typeof body.bankCode === 'string' ? body.bankCode : null;
    const accountNumber = typeof body.accountNumber === 'string' ? body.accountNumber : null;
    // What the client's own quote said it was delivering — needed to split the locked (gross)
    // amount back into its net and fee parts without re-deriving them from the gross, which
    // would require inverting `offrampFee`'s floor/cap logic. Verified below against the amount
    // actually locked on-chain, so a stale or tampered value cannot misroute the fee.
    const claimedNetUsdc = Number(body.netUsdc);

    if (!TX_HASH.test(txHash)) {
      return NextResponse.json({ error: 'Invalid transaction hash' }, { status: 400 });
    }
    if (!isRail(rail)) {
      return NextResponse.json({ error: 'Unknown destination' }, { status: 400 });
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

    const receipt = await getProvider().getTransactionReceipt(txHash);
    if (!receipt) return NextResponse.json({ error: 'Transaction not found yet' }, { status: 404 });
    if (receipt.status !== 1) {
      return NextResponse.json({ error: 'Lock transaction reverted' }, { status: 400 });
    }

    // Pull the lock out of the receipt. This is the only source of truth for what happened.
    const escrow = getEscrowReadOnly();
    const event = receipt.logs
      .filter((log) => log.address.toLowerCase() === getEscrowAddress().toLowerCase())
      .map((log) => {
        try {
          return escrow.interface.parseLog({ topics: [...log.topics], data: log.data });
        } catch {
          return null;
        }
      })
      .find((entry) => entry?.name === 'OfframpRequested');

    if (!event) {
      return NextResponse.json({ error: 'No off-ramp lock in this transaction' }, { status: 400 });
    }

    const lockedBy = String(event.args[0]).toLowerCase();
    const amount = BigInt(event.args[1]);
    const token = String(event.args[2]).toLowerCase();
    const recipientPhoneHash = String(event.args[3]).toLowerCase();
    const requestId = String(event.args[4]).toLowerCase();
    const deadline = Number(event.args[5]);

    if (lockedBy !== wallet.address.toLowerCase()) {
      return NextResponse.json({ error: 'This lock was not made by your wallet' }, { status: 403 });
    }

    if (!Number.isFinite(claimedNetUsdc) || claimedNetUsdc <= 0) {
      return NextResponse.json({ error: 'Missing the intended delivery amount' }, { status: 400 });
    }

    // Recomputed forward from the claimed net (never inverted from the gross — see the comment
    // on `claimedNetUsdc` above) and checked against what actually got locked. A mismatch means
    // a stale quote or a tampered value; either way settlement must not run against numbers that
    // do not match the chain. The lock itself already happened and stays refundable regardless.
    const feeBreakdown = offrampFee(claimedNetUsdc);
    const expectedLocked = parseUnits(feeBreakdown.grossUsdc.toFixed(6), 6);
    if (expectedLocked !== amount) {
      return NextResponse.json(
        { error: 'This lock does not match a current quote — it will become refundable once the rate lock expires.' },
        { status: 409 }
      );
    }

    const { data: user } = await supabase
      .from('users')
      .select('country_code')
      .eq('id', session.userId)
      .maybeSingle();
    const currency = currencyForCountry(user?.country_code);
    const fx = await getUsdRate(currency.code);

    // Defense in depth: `/api/offramp/quote` is the gate a normal client hits first, but the
    // lock itself is a signed on-chain transaction the client could send without ever calling
    // that route. Refusing here can't undo the lock — it's already mined — but it does stop
    // settlement, and the funds aren't stranded: `refund()` on the escrow is callable by anyone
    // once the rate-lock expires (PRD Section 5.3).
    const policy = await getCompliancePolicy(user?.country_code);
    if (!isOfframpAllowed(policy)) {
      return NextResponse.json({ error: offrampDisabledMessage(policy) }, { status: 403 });
    }

    // Recorded as `locked` before settlement is attempted. If the process dies mid-settle the
    // row still exists, still points at a real on-chain lock, and is still refundable.
    const { data: inserted, error: insertError } = await supabase.from('offramp_requests').insert({
      user_id: session.userId,
      request_id: requestId,
      chain_id: CHAIN_ID,
      escrow_address: getEscrowAddress().toLowerCase(),
      token_address: token,
      token_decimals: 6,
      amount: amount.toString(),
      net_usdc: feeBreakdown.netUsdc,
      fee_usdc: feeBreakdown.feeUsdc,
      recipient_phone_hash: recipientPhoneHash,
      recipient_rail: rail,
      idr_usd_rate: fx.rate,
      rate_expires_at: new Date(deadline * 1000).toISOString(),
      status: 'locked',
      stable_token_address: getStableTokenAddress().toLowerCase(),
      lock_tx_hash: txHash.toLowerCase(),
    })
      .select('id')
      .single();

    // A replay of the same lock collides on `request_id`; the row is already there.
    if (insertError && insertError.code !== '23505') throw insertError;

    // The history row below points back at this request, and the id it needs is generated by
    // the insert above. Not asking for it is why `transactions.offramp_request_id` sat empty
    // through every off-ramp this app has ever done: the value existed for four lines and was
    // thrown away. On a replay the insert returned nothing, so it comes from the row that won.
    let offrampRequestId = inserted?.id ?? null;
    if (!offrampRequestId) {
      const { data: existing } = await supabase
        .from('offramp_requests')
        .select('id')
        .eq('request_id', requestId)
        .maybeSingle();
      offrampRequestId = existing?.id ?? null;
    }

    await supabase.from('transactions').insert({
      tx_hash: txHash.toLowerCase(),
      chain_id: CHAIN_ID,
      type: 'offramp_lock',
      status: 'confirmed',
      from_address: lockedBy,
      to_address: getEscrowAddress().toLowerCase(),
      token_address: getUsdcAddress().toLowerCase(),
      amount: amount.toString(),
      user_id: session.userId,
      counterparty_phone_hash: recipientPhoneHash,
      block_number: receipt.blockNumber,
      offramp_request_id: offrampRequestId,
    });

    // The lock is real and recorded — respond now. Settlement keeps running after this request
    // ends; the client finds out how it went by polling GET /api/offramp/[requestId].
    waitUntil(
      settleInBackground({
        requestId,
        token,
        amount,
        netUsdc: feeBreakdown.netUsdc,
        grossUsdc: feeBreakdown.grossUsdc,
        deadline,
        userId: session.userId,
        rail,
        recipientPhone,
        countryCode,
        bankCode,
        accountNumber,
        recipientPhoneHash,
        currency,
        fxRate: fx.rate,
        policy,
      })
    );

    return NextResponse.json({
      success: true,
      requestId,
      status: 'locked',
      rateExpiresAt: new Date(deadline * 1000).toISOString(),
    });
  } catch (error) {
    const { message, isSchemaDrift, code } = describeDbError(error, 'Could not process this transfer');
    console.error('[offramp/lock]', code ?? '', message);
    return NextResponse.json({ error: message, schemaOutOfDate: isSchemaDrift || undefined }, { status: 500 });
  }
}
