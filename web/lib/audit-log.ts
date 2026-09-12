/**
 * The record of what happened to an account's access.
 *
 * Replaces `lib/audit-logger.ts`, which was written and then never called from anywhere — so
 * there was no trail at all for sign-ins, failed codes, or wallet provisioning, which is exactly
 * what someone would need to notice an account being worked on. Two things about it also had to
 * change before it could be wired in:
 *
 *  - It took a **plain phone number** and wrote it to a `phone_number` column. Every other part of
 *    this codebase goes out of its way never to store one (`lib/phone.ts`), and an audit table is
 *    a strange place to make the exception — it is long-lived, rarely looked at, and would have
 *    quietly become the one place a database dump yields a contact list. It takes a hash now.
 *  - It built its own Supabase client from raw env vars, side-stepping the guards in
 *    `getSupabaseAdmin` that keep the service-role key out of the browser and catch an anon key
 *    pasted into the wrong variable.
 *
 * Signing decisions are *not* logged here — they go to `signing_events` via `lib/spend-limits.ts`,
 * which carries the amounts and counterparties this table has no business holding.
 */

import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { extractClientIP, extractUserAgent } from '@/lib/request-meta';

export type AuthEventType =
  | 'otp_requested'
  | 'otp_request_rate_limited'
  | 'otp_send_failed'
  | 'otp_verify_failed'
  | 'otp_verify_succeeded'
  | 'account_created'
  | 'session_revoked'
  | 'wallet_provisioned'
  // Recovery-factor changes. Every one of these alters who can reach the account, which is the
  // shortest description of what this log is for.
  | 'backup_email_verified'
  | 'backup_email_removed'
  | 'guardian_invited'
  | 'guardian_approved'
  | 'guardian_revoked'
  // A guardian's vote on a live recovery, as opposed to their answer to the invitation above.
  // Separated by channel because an off-app guardian was authorised by a link rather than a
  // session, and a run of link-authorised votes is the shape worth being able to search for.
  | 'recovery_guardian_voted'
  // The scheduled sweep returned an expired off-ramp lock (`/api/offramp/sweep`). The one entry
  // here that is not about reaching an account: it is recorded because it is the only event in
  // this system where Saku moves a user's money with no user present, and "the operator acted on
  // your funds by itself" is worth being able to list per account. The amounts and the transaction
  // live with the money, in `transactions` and `offramp_requests`, not in this row.
  | 'auto_refund_triggered';

export interface AuthEvent {
  type: AuthEventType;
  /** keccak256 of the number. Never the number. */
  phoneHash?: string | null;
  userId?: string | null;
  /** Small, non-sensitive context: a country code, a failure reason. Never a code or a token. */
  metadata?: Record<string, string | number | boolean | null>;
}

/**
 * Write one event.
 *
 * Never throws and never blocks a decision: an audit write that takes down the request it is
 * auditing converts a logging problem into an outage. Failures are logged loudly rather than
 * swallowed — the old version caught and discarded everything, so a table that had silently
 * stopped accepting rows would have looked identical to one working perfectly.
 */
export async function logAuthEvent(request: Request, event: AuthEvent): Promise<void> {
  try {
    await getSupabaseAdmin()
      .from('auth_events')
      .insert({
        event_type: event.type,
        phone_hash: event.phoneHash ?? null,
        user_id: event.userId ?? null,
        ip: extractClientIP(request),
        user_agent: extractUserAgent(request)?.slice(0, 400) ?? null,
        metadata: event.metadata ?? {},
      });
  } catch (error) {
    console.error(`[audit] could not record ${event.type}:`, error);
  }
}
