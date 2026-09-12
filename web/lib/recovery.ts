/**
 * The rules a recovery has to satisfy before an account changes hands.
 *
 * Recovery is the most dangerous path in the product. Every other flow asks someone holding the
 * phone number to prove something; this one hands the account to someone who, by definition,
 * does not have it. So the bar is two independent proofs plus people, and the checks live here
 * rather than inside a route, where a later edit could quietly drop one.
 *
 * The order, and what each step proves:
 *
 *  1. The backup email answered a link. That is the claim "this account is mine".
 *  2. A majority of the guardians said yes, and never fewer than two of them. Email accounts get
 *     compromised, and one more thing the attacker already has is not a second factor. People who
 *     know the owner are different evidence — and a majority of them, so fooling the most trusting
 *     one is not enough. See {@link MIN_GUARDIAN_QUORUM} for why a majority alone did not deliver
 *     that.
 *  3. Only then does the requester choose the new number, and that number answers an OTP.
 *     Otherwise a recovery could point an account at a number the requester does not control,
 *     which is a takeover with extra steps.
 *  4. None of it has expired.
 *
 * Why the number comes last: someone who has just lost their number should not have to pick a
 * destination before they know the recovery can succeed, and the guardians never saw the
 * destination anyway. What keeps "choose any number after approval" from being a blank cheque is
 * who can reach that step — only the holder of a link mailed to the backup address after the
 * guardians said yes, and only for {@link RECOVERY_FINISH_WINDOW_MS}.
 *
 * Note what is deliberately NOT enough on its own: a verified email. An account with an email and
 * fewer than two usable guardians cannot complete a recovery. That is a real cost, stated plainly
 * on the settings screen, and the alternative is that taking someone's email — plus one person
 * who trusts them — takes their money.
 */

export const RECOVERY_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Seven days, not one and not thirty.
 *
 * The wait is on guardians, who are ordinary people with lives — an hour or a day would expire
 * honest requests while someone is asleep, travelling, or simply not looking at their phone, and
 * an expired recovery means starting over from an account you still cannot reach.
 *
 * It stops at a week because a pending request is itself a standing offer: anyone who gets into
 * that email account later can finish a recovery somebody else started. A month of that is a
 * month of exposure bought for nothing, since guardians who have not answered in seven days are
 * not about to.
 */
export function recoveryExpiresAt(nowMs: number = Date.now()): Date {
  return new Date(nowMs + RECOVERY_WINDOW_MS);
}

/**
 * How long the owner has to choose a new number once the guardians have approved.
 *
 * The finish link is the most powerful thing this flow ever sends: whoever opens it can point
 * the account at a number of their choosing. So it replaces the request's remaining week rather
 * than adding to it. Twenty-four hours, because the owner is the one waiting on this email and
 * has every reason to act on it the same day; anything longer only lengthens the time an
 * intercepted link stays useful.
 */
export const RECOVERY_FINISH_WINDOW_MS = 24 * 60 * 60 * 1000;

export function recoveryFinishExpiresAt(nowMs: number = Date.now()): Date {
  return new Date(nowMs + RECOVERY_FINISH_WINDOW_MS);
}

/**
 * The fewest guardians that can ever decide a recovery, whatever the panel's size.
 *
 * A strict majority alone does not bound this: the majority of one is one. So an account with a
 * single guardian had a one-person recovery path, and that one person is the whole of the second
 * factor — an attacker who has the backup email and talks the only guardian into tapping approve
 * is done. "Fooling the most trusting guardian is not enough" is only true when there is more
 * than one to be trusting.
 *
 * Two, not three. Three would mean the maximum panel ({@link MAX_GUARDIANS}) has no slack at all:
 * one guardian who changed phones and the owner is locked out for good, and an unrecoverable
 * account is the failure this whole flow exists to prevent. Two keeps a second pair of eyes on
 * every recovery while a panel of three still tolerates one person being unreachable.
 *
 * The cost is stated plainly rather than hidden: an account with one guardian cannot be
 * recovered. It is refused at {@link canFormGuardianQuorum} — before any email is sent, so the
 * owner is told while they still have the account and can add a second guardian, not after a wait
 * that could never end.
 */
export const MIN_GUARDIAN_QUORUM = 2;

/**
 * How many guardians must approve: a strict majority of the panel, never fewer than
 * {@link MIN_GUARDIAN_QUORUM}.
 *
 * One approval used to be enough, which made every guardian added a liability — an attacker only
 * had to fool the most trusting of them. Requiring all of them fails the other way: one guardian
 * who changed phones or fell out of touch would leave the account unrecoverable for good. A
 * majority sits between. A minority can never decide, and from three guardians up, one can be
 * unreachable.
 *
 * 1 → 2 (unreachable by design — see {@link canFormGuardianQuorum}), 2 → 2, 3 → 2.
 */
export function requiredGuardianApprovals(panelSize: number): number {
  return Math.max(MIN_GUARDIAN_QUORUM, Math.floor(panelSize / 2) + 1);
}

/**
 * Whether a panel this size can ever reach its own bar.
 *
 * Deliberately a separate question from {@link requiredGuardianApprovals}, which answers honestly
 * that a panel of one needs two. Nothing may quietly lower the bar to fit a short panel; the
 * panel is refused instead, and this is the function that refuses it. Every gate that decides
 * whether a recovery may begin asks this rather than comparing numbers itself.
 */
export function canFormGuardianQuorum(panelSize: number): boolean {
  return panelSize >= MIN_GUARDIAN_QUORUM;
}

export type RecoveryStatus = 'pending' | 'approved' | 'rejected' | 'expired';

export interface RecoveryRequestRow {
  id: string;
  status: RecoveryStatus;
  email_verified_at: string | null;
  /** When the guardian majority was reached. Null while votes are still coming in. */
  guardian_approved_at: string | null;
  expires_at: string;
}

export function isRecoveryExpired(row: RecoveryRequestRow, nowMs: number = Date.now()): boolean {
  return new Date(row.expires_at).getTime() <= nowMs;
}

/** Every proof, together. The only question the move to a new number is allowed to ask. */
export function canCompleteRecovery(row: RecoveryRequestRow, nowMs: number = Date.now()): boolean {
  if (row.status !== 'pending') return false;
  if (isRecoveryExpired(row, nowMs)) return false;
  if (!row.email_verified_at) return false;
  if (!row.guardian_approved_at) return false;
  return true;
}

/**
 * Whether a new request may replace the account's open one.
 *
 * Starting a recovery needs nothing but the old number, which is easy to learn. If every start
 * replaced the open request, anyone who knew the number could cancel an owner's recovery midway,
 * as often as they liked. So once the email has answered — the point at which the request is
 * demonstrably the owner's — it stands until it finishes, is rejected, or expires.
 *
 * An unconfirmed one stays replaceable, or a stranger's request that nobody will ever confirm
 * would block the owner's own for a week.
 */
export function canReplaceOpenRecovery(row: RecoveryRequestRow, nowMs: number = Date.now()): boolean {
  return isRecoveryExpired(row, nowMs) || !row.email_verified_at;
}

export type RecoveryStage =
  | 'awaiting_email'
  | 'awaiting_guardian'
  | 'choose_number'
  | 'done'
  | 'rejected'
  | 'expired';

/** Where the request stands, for the screens. Derived, so it cannot disagree with the gate above. */
export function recoveryStage(row: RecoveryRequestRow, nowMs: number = Date.now()): RecoveryStage {
  if (row.status === 'approved') return 'done';
  if (row.status === 'rejected') return 'rejected';
  if (row.status !== 'pending' || isRecoveryExpired(row, nowMs)) return 'expired';
  if (!row.email_verified_at) return 'awaiting_email';
  if (!row.guardian_approved_at) return 'awaiting_guardian';
  return 'choose_number';
}
