/**
 * Observe a lock the user just signed, then settle it — PRD 5.1 steps 5 through 9.
 *
 * The client sends a transaction hash, never an amount or a request id. Everything recorded here
 * is parsed out of the `OfframpRequested` event in that transaction's receipt, so a caller
 * cannot file a request for funds they did not lock, nor claim a different amount than the one
 * the contract saw.
 *
 * Settlement runs inline rather than on a queue. `lockForOfframp` fixes a deadline 120 seconds
 * out and `settleOfframp` reverts past it, so anything that defers this work is racing a clock
 * it cannot see. If the swap does fail, the request stays `locked` and becomes refundable —
 * which is the PRD Section 5.3 state-desync mitigation, not an error path we invented.
 */

import { NextResponse } from 'next/server';
import { formatUnits } from 'ethers';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { verifyToken, extractTokenFromHeader } from '@/lib/jwt';
import { CHAIN_ID, getProvider, getUsdcAddress } from '@/lib/chain';
import {
  getEscrowAddress,
  getEscrowReadOnly,
  getStableTokenAddress,
  settleOfframp,
} from '@/lib/escrow';
import { currencyForCountry } from '@/lib/currency';
import { getUsdRate } from '@/lib/fx';
import { isRail, mockDisbursement, mockExchange, type Rail } from '@/lib/mock-fiat';
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
}): Promise<DisbursementOutcome> {
  const channel = disbursementChannelFor(params.rail);
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

    if (params.rail === 'bank' && params.bankCode && params.accountNumber) {
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

    const { data: user } = await supabase
      .from('users')
      .select('country_code')
      .eq('id', session.userId)
      .maybeSingle();
    const currency = currencyForCountry(user?.country_code);
    const fx = await getUsdRate(currency.code);

    // Recorded as `locked` before settlement is attempted. If the process dies mid-settle the
    // row still exists, still points at a real on-chain lock, and is still refundable.
    const { error: insertError } = await supabase.from('offramp_requests').insert({
      user_id: session.userId,
      request_id: requestId,
      chain_id: CHAIN_ID,
      escrow_address: getEscrowAddress().toLowerCase(),
      token_address: token,
      token_decimals: 6,
      amount: amount.toString(),
      recipient_phone_hash: recipientPhoneHash,
      recipient_rail: rail,
      idr_usd_rate: fx.rate,
      rate_expires_at: new Date(deadline * 1000).toISOString(),
      status: 'locked',
      stable_token_address: getStableTokenAddress().toLowerCase(),
      lock_tx_hash: txHash.toLowerCase(),
    });

    // A replay of the same lock collides on `request_id`; the row is already there.
    if (insertError && insertError.code !== '23505') throw insertError;

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
    });

    // ── Settle: the real swap, then the two simulated fiat legs ──────────────────
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

      // The platform fee is retained from the swap proceeds; the recipient is paid the rest.
      const lockedUsdc = Number(formatUnits(amount, 6));
      const fee = offrampFee(lockedUsdc);
      const payableStable = stableOut * (fee.netUsdc / lockedUsdc);

      const exchange = await mockExchange(payableStable, currency.code, fx.rate);
      const disbursement = await settleDisbursement({
        rail,
        recipientPhone,
        countryCode,
        bankCode,
        accountNumber,
        expectedHash: recipientPhoneHash,
        requestId,
        fiatAmount: exchange.fiatAmount,
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

      await supabase.from('transactions').insert({
        tx_hash: settleReceipt.hash.toLowerCase(),
        chain_id: CHAIN_ID,
        type: 'offramp_settle',
        status: 'confirmed',
        amount: amount.toString(),
        user_id: session.userId,
        counterparty_phone_hash: recipientPhoneHash,
        block_number: settleReceipt.blockNumber,
      }).then(({ error: e }) => { if (e && e.code !== '23505') throw e; });

      await supabase.from('notifications').insert({
        user_id: session.userId,
        type: 'offramp_status',
        message: 'Your transfer has been sent.',
        metadata: { request_id: requestId, settle_tx: settleReceipt.hash.toLowerCase() },
      });

      return NextResponse.json({
        success: true,
        requestId,
        status: 'settled',
        settleTxHash: settleReceipt.hash,
        stableOut,
        feeUsdc: fee.feeUsdc,
        netUsdc: fee.netUsdc,
        fiatAmount: exchange.fiatAmount,
        currency: currency.code,
        // Named in the response, not just in a comment: the caller should be able to tell which
        // half of this actually moved money. 'exchange' (stable token -> IDR) is always
        // simulated — there is no live venue selling the swapped mBUSD for rupiah, so the payout
        // is funded from Saku's own Xendit balance, not from an actual sale of what was locked.
        // 'disbursement' is real whenever the destination is GoPay/OVO/DANA/ShopeePay and the
        // Xendit call succeeds; `disbursement.simulated` says which happened for this transfer.
        simulatedLegs: disbursement.simulated ? ['exchange', 'disbursement'] : ['exchange'],
        disbursementReal: !disbursement.simulated,
      });
    } catch (settleError) {
      const reason = settleError instanceof Error ? settleError.message : 'Settlement failed';
      await supabase
        .from('offramp_requests')
        .update({ failure_reason: reason.slice(0, 500) })
        .eq('request_id', requestId);

      // Deliberately not an error response: the lock is real and the funds are recoverable.
      // The request stays `locked` and becomes refundable once the deadline passes.
      return NextResponse.json({
        success: true,
        requestId,
        status: 'locked',
        settlementFailed: reason,
        refundableAfter: new Date(deadline * 1000).toISOString(),
      });
    }
  } catch (error) {
    const { message, isSchemaDrift, code } = describeDbError(error, 'Could not process this transfer');
    console.error('[offramp/lock]', code ?? '', message);
    return NextResponse.json({ error: message, schemaOutOfDate: isSchemaDrift || undefined }, { status: 500 });
  }
}
