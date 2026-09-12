/**
 * What a guardian is allowed to do, and when.
 *
 * The one rule worth stating up front, because everything else follows from it: a guardian is
 * usable for recovery only once a human has approved the invitation AND the cooling period has
 * elapsed. `status` is display copy. `approved_at` and `effective_at` are the gate.
 *
 * Keeping those apart matters. A status string is written by whichever route ran last and can
 * fall out of date with the clock the moment it is stored; two timestamps cannot. Anything that
 * grants power asks {@link isGuardianEligible}, never the string.
 */

import { MIN_GUARDIAN_QUORUM } from '@/lib/recovery';

/**
 * How long an approved guardian waits before they count.
 *
 * The threat is not a stranger. It is someone holding a live session — a snatched unlocked
 * phone, a SIM swap that already succeeded — adding an account they control and approving it
 * from the same device seconds later. Without a delay that is a complete, silent takeover of the
 * recovery path, and the real owner learns about it when they can no longer get in.
 *
 * The window starts at approval rather than at invitation, so an attacker cannot pre-warm an
 * invite and have the clock already spent by the time they approve it.
 *
 * Twenty-four hours for the same reason the email change waits that long: the notice has to
 * survive one night's sleep. Shorter and it expires while the owner is asleep, which is exactly
 * when a stolen phone gets used. Longer and it becomes a hostage for the honest user, who is
 * sitting there locked out watching a clock.
 */
export const GUARDIAN_COOLING_PERIOD_MS = 24 * 60 * 60 * 1000;

/** The most guardians one account may hold. Also enforced by a trigger, which is the real cap. */
export const MAX_GUARDIANS = 3;

export type GuardianStatus = 'invited' | 'pending' | 'approved' | 'revoked';

export interface GuardianRow {
  id: string;
  status: GuardianStatus;
  approved_at: string | null;
  effective_at: string;
  revoked_at?: string | null;
}

/** The two ways a guardian can be contacted when a recovery needs their answer. */
export interface GuardianReach {
  guardian_user_id?: string | null;
  invite_phone_ciphertext?: string | null;
}

/**
 * Can this guardian actually be asked?
 *
 * Separate from {@link isGuardianEligible}, which asks whether they are *allowed* to vouch.
 * A guardian who is allowed but unreachable is worse than no guardian: they are counted into the
 * majority, so they raise the bar the owner has to clear while contributing nothing towards it.
 *
 * Two ways of being reachable. A Saku account takes the in-app path, authenticated by their own
 * session. A stored number takes the WhatsApp path — which is why the number is encrypted rather
 * than only hashed; see `lib/guardian-invite.ts`.
 *
 * This exists because the panel used to be built with `.filter(g => g.guardian_user_id)`, which
 * silently dropped every guardian invited by phone. The feature would have shipped doing nothing.
 */
export function isGuardianReachable(row: GuardianReach): boolean {
  return !!(row.guardian_user_id || row.invite_phone_ciphertext);
}

/**
 * The authoritative question: may this guardian vouch for a recovery right now?
 *
 * Deliberately not `status === 'approved'`. A row can say approved while its cooling period is
 * still running, which is the entire window the delay exists to create.
 */
export function isGuardianEligible(row: GuardianRow, nowMs: number = Date.now()): boolean {
  if (row.status === 'revoked') return false;
  if (!row.approved_at) return false;
  return new Date(row.effective_at).getTime() <= nowMs;
}

/** When an approval granted now starts counting. */
export function guardianEffectiveAt(nowMs: number = Date.now()): Date {
  return new Date(nowMs + GUARDIAN_COOLING_PERIOD_MS);
}

export type GuardianDisplayState = 'awaiting_response' | 'cooling_down' | 'active' | 'revoked';

/**
 * What the owner's settings screen should say about this row.
 *
 * Derived rather than stored, so a guardian never shows as active while the gate above would
 * still refuse them. One place decides; the screen and the recovery check cannot disagree.
 */
export function guardianDisplayState(
  row: GuardianRow,
  nowMs: number = Date.now()
): GuardianDisplayState {
  if (row.status === 'revoked') return 'revoked';
  if (!row.approved_at) return 'awaiting_response';
  return isGuardianEligible(row, nowMs) ? 'active' : 'cooling_down';
}

/** Milliseconds until an approved-but-cooling guardian becomes usable. Zero once they are. */
export function guardianCooldownRemainingMs(row: GuardianRow, nowMs: number = Date.now()): number {
  if (!row.approved_at || row.status === 'revoked') return 0;
  return Math.max(0, new Date(row.effective_at).getTime() - nowMs);
}

/**
 * Whether the account has any recovery factor at all.
 *
 * This decides whether to nudge someone to start setting recovery up at all: an account with
 * neither factor is the one that loses everything along with its number. It is NOT whether a
 * recovery would succeed. That takes a verified email AND {@link MIN_GUARDIAN_QUORUM} usable
 * guardians — see {@link isRecoveryReady} — and "guardians can be added later" does not rescue an
 * email-only account, because adding one needs a sign-in the owner no longer has.
 *
 * So an account one guardian short still reads as having a path here while `isRecoveryReady` says
 * no, and that gap is deliberate: this answers "has this person started", which is a different
 * prompt from "finish this". The screens that chase the second guardian read the count, not this.
 */
export function hasRecoveryPath(params: {
  emailVerified: boolean;
  guardians: GuardianRow[];
  nowMs?: number;
}): boolean {
  const now = params.nowMs ?? Date.now();
  return (
    params.emailVerified || params.guardians.some((g) => isGuardianEligible(g, now))
  );
}

/**
 * Whether a recovery started right now could finish: a verified backup email and enough guardians
 * past their cooling period to reach a quorum — {@link MIN_GUARDIAN_QUORUM} of them, not one.
 *
 * The same two conditions `app/api/recovery/start` checks before it sends anything, so a status
 * built on this cannot say "on" while the recovery screen says no. It used to ask for a single
 * eligible guardian, which is the condition the quorum floor replaced: one guardian is a recovery
 * path one person can open by themselves.
 *
 * Counted, not `.some()`, for that reason — the number is the whole point.
 */
export function isRecoveryReady(params: {
  emailVerified: boolean;
  guardians: GuardianRow[];
  nowMs?: number;
}): boolean {
  const now = params.nowMs ?? Date.now();
  return params.emailVerified && countEligibleGuardians(params.guardians, now) >= MIN_GUARDIAN_QUORUM;
}

/**
 * How many of these guardians could vote on a recovery today.
 *
 * Exists so the quorum check, the settings screen and `app/api/recovery/start` all arrive at the
 * same number from the same rule, rather than three `.filter(...).length` chains that can drift
 * apart on what "eligible" means.
 */
export function countEligibleGuardians(guardians: GuardianRow[], nowMs: number = Date.now()): number {
  return guardians.filter((g) => isGuardianEligible(g, nowMs)).length;
}

/**
 * When the soonest approved-but-cooling guardian starts counting, or null if none is on the way.
 *
 * An invitation nobody has answered is not "on the way" — it may never be accepted — so only
 * approved guardians have a date to give.
 */
export function nextGuardianActiveAt(guardians: GuardianRow[], nowMs: number = Date.now()): Date | null {
  const upcoming = guardians
    .filter((g) => g.status !== 'revoked' && g.approved_at && !isGuardianEligible(g, nowMs))
    .map((g) => new Date(g.effective_at).getTime());
  return upcoming.length > 0 ? new Date(Math.min(...upcoming)) : null;
}
