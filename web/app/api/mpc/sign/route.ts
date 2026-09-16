/**
 * Sign a transaction with the caller's wallet.
 *
 * This is the most dangerous route in the application, and it is worth being precise about what
 * now stands between a request and someone's money:
 *
 *  1. **The session is a cookie script cannot read** (`lib/session.ts`), so an injected script
 *     cannot lift it and use it from elsewhere, and a revoked session stops working at once.
 *  2. **The transaction is decoded and vetted** (`lib/tx-policy.ts`). Saku signs four kinds of
 *     call to three of its own contracts, on one chain, never with native value attached.
 *     Everything else is refused — including approving any spender that is not Saku's own escrow
 *     or staking pool, which is how a quiet drain would otherwise be set up.
 *  3. **The wallet comes from `wallets`, keyed by the session's `user_id`** — never from the
 *     request body — so a caller can only ever sign with their own.
 *  4. **A rolling daily cap** (`lib/spend-limits.ts`) bounds what a session that is already
 *     compromised can move before someone notices.
 *  5. **Every decision is recorded** in `signing_events`, refusals included.
 *
 * What none of that changes: a live session is still sufficient to pay an arbitrary address,
 * because that is what a wallet does. Points 1, 4 and 5 are the answer to that — make the session
 * hard to steal, bound the damage, and leave a trail.
 */

import { NextResponse } from 'next/server';
import { getSession, unauthorized } from '@/lib/session';
import { signWithWallet } from '@/lib/privy';
import { SignerQuotaError, SignerUnreachableError } from '@/lib/signer-errors';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { CHAIN_ID } from '@/lib/chain';
import { checkRateLimit, RATE_LIMITS } from '@/lib/rate-limiter';
import { extractClientIP, extractUserAgent } from '@/lib/request-meta';
import { assertSignable, TxPolicyError, type SignedIntent } from '@/lib/tx-policy';
import { checkDailyCap, recordSigningEvent, type SigningContext } from '@/lib/spend-limits';

/**
 * Read the body and decode it, carrying a refusal instead of throwing it.
 *
 * The refusal has to be recorded against the caller's wallet, and that lookup is deliberately in
 * flight at the same time as this — so the failure is returned as a value and acted on below,
 * once there is a wallet to record it against.
 */
async function readIntent(
  request: Request
): Promise<
  | { ok: true; unsignedTransaction: string; intent: SignedIntent }
  | { ok: false; message: string }
> {
  try {
    const body = await request.json();
    const unsignedTransaction = String(body.unsignedTransaction ?? '');
    return { ok: true, unsignedTransaction, intent: assertSignable(unsignedTransaction) };
  } catch (err) {
    return {
      ok: false,
      message: err instanceof TxPolicyError ? err.message : 'Invalid unsigned transaction',
    };
  }
}

export async function POST(request: Request) {
  const session = await getSession(request);
  if (!session) return unauthorized();

  const supabase = getSupabaseAdmin();

  /**
   * Three pieces of work that do not feed each other, started together rather than one after the
   * next: counting this request against the limiter, finding which wallet the session owns, and
   * decoding what is being asked for. Each was a separate round trip to Postgres or to the
   * request body, and a signature waited through all three in sequence before anything began.
   *
   * Only the *timing* changes. Every decision below is made in the same order it was before, on
   * the same evidence, and each one still returns before the next is considered — the limiter
   * still refuses ahead of the wallet lookup, and nothing is signed until all three have passed.
   * What a refused caller costs Saku is two reads it would previously have avoided, which is the
   * trade this makes knowingly: a read apiece on the rare refusal, against a round trip apiece on
   * every legitimate payment.
   */
  // Keyed on the user, not the IP. An attacker changes IP for free; what they cannot change is
  // which account they are draining, and that is the thing worth counting.
  const limitPending = checkRateLimit(`sign:${session.userId}`, RATE_LIMITS.SIGNING);
  const walletPending = supabase
    .from('wallets')
    .select('address, privy_wallet_id')
    .eq('user_id', session.userId)
    .eq('chain_id', CHAIN_ID)
    .maybeSingle();
  const intentPending = readIntent(request);

  const limit = await limitPending;
  if (!limit.allowed) {
    return NextResponse.json(
      { error: 'Too many signing requests. Wait a moment and try again.' },
      { status: 429 }
    );
  }

  const { data: wallet, error: walletError } = await walletPending;

  if (walletError) {
    console.error('[mpc/sign] wallet lookup failed:', walletError);
    return NextResponse.json({ error: 'Failed to sign transaction' }, { status: 500 });
  }
  if (!wallet?.privy_wallet_id) {
    return NextResponse.json({ error: 'No wallet provisioned for this session' }, { status: 409 });
  }

  const context: SigningContext = {
    userId: session.userId,
    address: wallet.address,
    ip: extractClientIP(request),
    userAgent: extractUserAgent(request),
  };

  const decoded = await intentPending;
  if (!decoded.ok) {
    // Recorded before the response goes out: a run of these against one account is the clearest
    // early sign that a session has been taken, and it is worth nothing if it is not written down.
    await recordSigningEvent(context, null, 'refused', decoded.message);
    return NextResponse.json({ error: decoded.message }, { status: 400 });
  }

  const { intent, unsignedTransaction } = decoded;

  try {
    const cap = await checkDailyCap(session.userId, intent);
    if (!cap.allowed) {
      await recordSigningEvent(context, intent, 'refused', cap.reason ?? 'daily cap');
      return NextResponse.json({ error: cap.reason }, { status: 429 });
    }
  } catch (err) {
    // `checkDailyCap` fails closed on purpose — see the note on it. Nothing is signed while the
    // one control bounding a compromised session cannot be evaluated.
    console.error('[mpc/sign] daily cap check failed:', err);
    await recordSigningEvent(context, intent, 'failed', 'cap check unavailable');
    return NextResponse.json(
      { error: 'Saku could not check your daily limit. Nothing was sent — try again shortly.' },
      { status: 503 }
    );
  }

  try {
    const signedTransaction = await signWithWallet(
      wallet.privy_wallet_id,
      wallet.address,
      unsignedTransaction
    );

    await recordSigningEvent(context, intent, 'signed');
    return NextResponse.json({ signedTransaction });
  } catch (err) {
    // A network failure and a refusal are different things to be told. 503 also says "try
    // again", which is true here and is not true of the generic 500.
    if (err instanceof SignerQuotaError) {
      console.error('[mpc/sign] signing quota exhausted — the provider account needs more quota');
      await recordSigningEvent(context, intent, 'failed', 'signer quota exhausted');
      return NextResponse.json(
        { error: 'Signing is temporarily unavailable on this deployment. Nothing was sent.' },
        { status: 503 }
      );
    }

    if (err instanceof SignerUnreachableError) {
      console.error('[mpc/sign] signing provider unreachable');
      await recordSigningEvent(context, intent, 'failed', 'signer unreachable');
      return NextResponse.json(
        { error: "Couldn't reach the signing service. Check your connection and try again." },
        { status: 503 }
      );
    }

    console.error('[mpc/sign] failed:', err);
    await recordSigningEvent(context, intent, 'failed', 'signer error');
    return NextResponse.json({ error: 'Failed to sign transaction' }, { status: 500 });
  }
}
