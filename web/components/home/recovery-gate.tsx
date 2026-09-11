"use client"

/**
 * Decides when to send someone to the recovery setup.
 *
 * It renders nothing, ever. It used to mount the setup as a full-screen overlay on top of Home;
 * now the setup is a screen of its own at `/security/setup`, so all that is left here is the
 * decision of when to go there.
 *
 * Three rules, all from the same idea — this is a reminder, not a gate.
 *
 * It waits for the first-run tour to finish, because otherwise it would navigate out from under
 * someone still reading it. In practice the tour now hands over directly — its last slide is
 * about this — so for a new signup this gate is the fallback rather than the path.
 *
 * Dismissing snoozes rather than silences. An account with no way back is a standing problem, so
 * the reminder returns; but returning on every visit is how a prompt becomes something people
 * learn to tap past without reading. The week lives in `lib/recovery-snooze.ts`, which the setup
 * screen writes when someone taps "Not now".
 *
 * What it asks about is whether a recovery could ever work, not whether the account has any
 * factor at all. It used to open only for an account with neither, which left an owner with a
 * confirmed email and no guardian believing they were covered until the day recovery refused
 * them. Now it opens while either piece is missing — a confirmed email, and at least one guardian
 * (one still accepting, or inside the 24-hour wait, counts: there is nothing left for the owner to
 * do). The moment both are in place it stops firing on its own.
 *
 * It navigates with `replace`, not `push`. Nobody chose to come here, so Back should return to
 * whatever they were actually doing rather than bouncing them into the setup a second time.
 */

import { useEffect, useRef } from "react"
import { useRouter } from "next/navigation"

import { useAuth } from "@/hooks/useAuth"
import { isSnoozed } from "@/lib/recovery-snooze"

/** A tour still running, or a brand-new signup that has not been shown one yet. */
function tourIsOnScreen(): boolean {
  try {
    return (
      localStorage.getItem("saku_just_registered") !== null &&
      localStorage.getItem("saku_has_seen_onboarding") === null
    )
  } catch {
    return false
  }
}

export default function RecoveryGate() {
  const router = useRouter()
  const { isLoading, isAuthenticated, recovery } = useAuth()

  const needsSetup =
    !recovery.emailVerified || recovery.activeGuardians + recovery.pendingGuardians === 0

  // A navigation is not idempotent the way rendering an overlay was, and `recovery` changing
  // while the route is already unwinding would fire a second one. Once is once.
  const sent = useRef(false)

  useEffect(() => {
    if (isLoading || !isAuthenticated || !needsSetup || sent.current) return

    const evaluate = () => {
      if (tourIsOnScreen()) return
      if (isSnoozed()) return
      sent.current = true
      clearInterval(timer)
      router.replace("/security/setup")
    }

    // Poll, for the one case an immediate check cannot settle: the first-run tour closes without
    // telling anyone, and a new account should reach the setup the moment it does.
    //
    // The interval is created before the immediate check below, and that order is load-bearing:
    // `evaluate` clears `timer`, and calling it while this `const` is still in its temporal dead
    // zone threw a ReferenceError that took Home down for exactly the accounts this gate is for.
    const timer = setInterval(evaluate, 1200)

    // Run once before the first tick. Everyone who is not mid-tour — which is everyone but a
    // brand-new signup — was otherwise watching Home for 1.2 seconds before being moved off it,
    // long enough to read as a misfire rather than as a destination.
    evaluate()

    return () => clearInterval(timer)
  }, [isLoading, isAuthenticated, needsSetup, router])

  return null
}
