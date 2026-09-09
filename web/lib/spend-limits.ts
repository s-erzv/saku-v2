/**
 * A ceiling on what one session can move in a day, and the record of every signature that moved it.
 *
 * `lib/tx-policy.ts` decides *what shape* of transaction Saku will sign. It cannot decide whether
 * a legitimate-looking `transfer` is the user paying a friend or someone else emptying the
 * wallet, because those two are the same call. This is the control for that: a rolling
 * twenty-four-hour cap on USDC leaving the wallet, enforced where the client cannot reach it.
 *
 * The cap is a blast-radius limit, not a lock. It is set high enough that a real user does not
 * meet it and low enough that a compromised session cannot quietly take everything in one pass —
 * and crossing it leaves a row in `signing_events`, which is the only place a drain becomes
 * visible after the fact. Rows are written for refusals too, precisely because a burst of
 * refusals is the signal worth having.
 */

import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { USDC_DECIMALS } from '@/lib/chain';
import type { SignedIntent } from '@/lib/tx-policy';

const WINDOW_MS = 24 * 60 * 60 * 1000;

/** Base units per whole USDC. */
const ONE_USDC = BigInt(10) ** BigInt(USDC_DECIMALS);

/**
 * Default ceiling in whole USDC per rolling day, overridable per deployment.
 *
 * Deliberately not `Infinity` when the env var is absent: a cap that silently disables itself on
 * a deployment that forgot to configure it is the same failure mode as the hardcoded JWT secret
 * this codebase already removed once.
 */
export function dailyCapUsdc(): bigint {
  const raw = process.env.SAKU_DAILY_SIGN_CAP_USDC?.trim();
  const parsed = raw ? Number(raw) : NaN;
  const whole = Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 2_000;
  return BigInt(whole) * ONE_USDC;
}

export interface SigningContext {
  userId: string;
  address: string;
  ip: string | null;
  userAgent: string | null;
}

function format(baseUnits: bigint): string {
  const whole = baseUnits / ONE_USDC;
  const fraction = (baseUnits % ONE_USDC).toString().padStart(USDC_DECIMALS, '0').replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

/** Total USDC this user has had signed out in the last 24 hours. */
async function spentInWindow(userId: string): Promise<bigint> {
  const supabase = getSupabaseAdmin();
  const since = new Date(Date.now() - WINDOW_MS).toISOString();

  const { data, error } = await supabase
    .from('signing_events')
    .select('usdc_out')
    .eq('user_id', userId)
    .eq('outcome', 'signed')
    .gte('created_at', since);

  if (error) throw error;

  // `numeric` comes back as a string from PostgREST — parsing it as a Number would silently lose
  // precision above 2^53, which base units reach at about nine billion USDC.
  return (data ?? []).reduce((total, row) => total + BigInt(String(row.usdc_out ?? '0')), BigInt(0));
}

export interface CapDecision {
  allowed: boolean;
  /** Safe to show the user. Null when allowed. */
  reason: string | null;
}

/**
 * Would signing this intent take the user past the daily cap?
 *
 * Fails **closed**: if the ledger cannot be read, no signature is produced. An outage that
 * silently lifted the only spending limit in the system would be worse than one that stops
 * payments for a few minutes, and the user is told which of the two happened.
 */
export async function checkDailyCap(userId: string, intent: SignedIntent): Promise<CapDecision> {
  if (intent.usdcOut === BigInt(0)) return { allowed: true, reason: null };

  const cap = dailyCapUsdc();
  const already = await spentInWindow(userId);

  if (already + intent.usdcOut > cap) {
    const remaining = already >= cap ? BigInt(0) : cap - already;
    return {
      allowed: false,
      reason:
        `This would pass your daily limit of ${format(cap)} USDC. ` +
        `You have ${format(remaining)} USDC left today.`,
    };
  }

  return { allowed: true, reason: null };
}

export type SigningOutcome = 'signed' | 'refused' | 'failed';

/**
 * Record one signing decision.
 *
 * Never throws: an audit write that takes down the request it is auditing turns a logging
 * problem into an outage. A failure here is logged loudly instead, because a signing path that
 * has quietly stopped recording is worth noticing.
 */
export async function recordSigningEvent(
  context: SigningContext,
  intent: SignedIntent | null,
  outcome: SigningOutcome,
  detail?: string
): Promise<void> {
  try {
    await getSupabaseAdmin()
      .from('signing_events')
      .insert({
        user_id: context.userId,
        wallet_address: context.address,
        contract: intent?.contract ?? null,
        method: intent?.method ?? null,
        to_address: intent?.to ?? null,
        counterparty: intent?.counterparty ?? null,
        usdc_out: (intent?.usdcOut ?? BigInt(0)).toString(),
        outcome,
        detail: detail ?? null,
        ip: context.ip,
        user_agent: context.userAgent?.slice(0, 400) ?? null,
      });
  } catch (error) {
    console.error('[spend-limits] could not write signing_events row:', error);
  }
}
