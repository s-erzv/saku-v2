/**
 * When the recovery setup is allowed to ask again.
 *
 * Shared because the decision and the act are now on opposite sides of a navigation: the gate on
 * Home reads this to decide whether to send anyone to `/security/setup`, and the setup screen
 * writes it when someone taps "Not now". A second copy of the key in either file would mean a
 * dismissal that silences nothing.
 *
 * Every access is wrapped, because `localStorage` throws outright in private browsing and where
 * site data is blocked. The two failures are deliberately asymmetric: a read that fails returns 0
 * so the reminder still appears, and a write that fails is swallowed so the screen still closes.
 * A repeated reminder is an annoyance; an account with no way back is a lost account.
 */

const SNOOZE_KEY = "saku_recovery_prompt_snoozed_until"
const SNOOZE_MS = 7 * 24 * 60 * 60 * 1000

/** Epoch ms before which nothing should be asked. 0 when unknown — i.e. ask. */
export function snoozedUntil(): number {
  try {
    return Number(localStorage.getItem(SNOOZE_KEY) ?? 0)
  } catch {
    return 0
  }
}

export function isSnoozed(): boolean {
  return Date.now() < snoozedUntil()
}

/**
 * Quiet for a week. Long enough to forget the last one, short enough to still be asking — a
 * prompt that returns on every visit is one people learn to tap past without reading.
 */
export function snooze(): void {
  try {
    localStorage.setItem(SNOOZE_KEY, String(Date.now() + SNOOZE_MS))
  } catch {
    // Nothing to do. It will simply ask again sooner.
  }
}
