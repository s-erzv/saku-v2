/**
 * Rate limiting that survives the platform it runs on.
 *
 * This was a `Map` in module scope with a comment saying "upgrade to Redis for production
 * scalability". On serverless that is not a scalability note, it is a correctness one: each
 * instance has its own empty Map, every cold start resets it, and concurrent instances never see
 * each other's counts. Anything relying on it alone — which was `/api/mpc/sign`,
 * `/api/mpc/provision`, `/api/transfer/resolve`, `/api/ocr`, `/api/topup/create-payment` — was
 * effectively unlimited. `/api/request-otp` was the exception, and only because it also kept a
 * real counter in the database.
 *
 * The counter now lives in Postgres, incremented by `saku_rate_limit_hit` in a single statement
 * so two simultaneous requests cannot both read the same number. See
 * `db/migrations/20260910_session_and_signing_security.sql`.
 */

import { getSupabaseAdmin } from '@/lib/supabaseAdmin';

export interface RateLimitConfig {
  maxRequests: number;
  windowMs: number;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: Date | null;
}

/**
 * Count one request against `identifier`.
 *
 * Fails **open** on a database error, and this is the one place in the security work here where
 * that is the right call: a limiter is a shield in front of a route that has its own
 * authentication and its own authorization. If Postgres is unreachable, refusing every request
 * turns a limiter outage into a full outage, while allowing them degrades to the protection the
 * route had anyway. The spending cap in `lib/spend-limits.ts` makes the opposite choice, because
 * there the check *is* the control rather than a shield in front of one.
 */
export async function checkRateLimit(
  identifier: string,
  config: RateLimitConfig
): Promise<RateLimitResult> {
  try {
    const { data, error } = await getSupabaseAdmin().rpc('saku_rate_limit_hit', {
      p_bucket: identifier,
      p_window_ms: config.windowMs,
      p_max: config.maxRequests,
    });

    if (error) throw error;

    const row = Array.isArray(data) ? data[0] : data;
    if (!row) throw new Error('saku_rate_limit_hit returned no row');

    return {
      allowed: Boolean(row.allowed),
      remaining: Number(row.remaining ?? 0),
      resetAt: row.reset_at ? new Date(row.reset_at) : null,
    };
  } catch (error) {
    console.error('[rate-limiter] bucket check failed, allowing request:', error);
    return { allowed: true, remaining: 0, resetAt: null };
  }
}

/**
 * Rate limit configurations.
 *
 * `SIGNING` is deliberately far tighter than the rest. Every other route costs Saku a database
 * query; that one costs a signature against someone's wallet, and a legitimate user produces a
 * handful an hour, not dozens a minute.
 */
export const RATE_LIMITS = {
  OTP_REQUEST: { maxRequests: 3, windowMs: 5 * 60 * 1000 },
  OTP_VERIFY: { maxRequests: 10, windowMs: 5 * 60 * 1000 },
  IP_BASED: { maxRequests: 20, windowMs: 60 * 1000 },
  GENERAL_API: { maxRequests: 100, windowMs: 60 * 1000 },
  /** Per user, not per IP — an attacker's IP is theirs to change, the victim's account is not. */
  SIGNING: { maxRequests: 12, windowMs: 60 * 1000 },
  /** Contact-existence lookups. Enumerating who is on Saku should be slow and countable. */
  RESOLVE: { maxRequests: 15, windowMs: 60 * 1000 },
} as const;
