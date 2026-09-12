"use client"

/**
 * The way into account recovery from the profile screen.
 *
 * Its own row rather than a line inside the wallet card, because that card returns null until
 * the signing provider reports a connected wallet — so the one entry point to the only feature
 * that survives losing your phone number was hidden exactly when something had gone wrong. This
 * renders whenever someone is signed in, which is the only condition that matters.
 *
 * The subtitle states the consequence rather than the setting. "Recovery: off" is a status; "you
 * would lose this account" is the reason anyone would tap it.
 *
 * Three states, not two. An account with only one factor used to read "On", and its owner found
 * out otherwise on the recovery screen — the one moment they could no longer fix it. So "on"
 * means a recovery would work today, "almost" means it will once a guardian's wait runs out, and
 * everything else asks for the missing piece by name.
 *
 * It is loud only when there is something to do, and that is now literally two components. When
 * a factor is missing, `AccountRecoveryBanner` renders an amber card at the top of the screen
 * with the action in it. The rest of the time that card renders nothing at all and the status
 * lives in `AccountRecoveryRow`, a line in the Security group like any other setting. A card
 * that shouts in every state teaches people to stop seeing it; a card that vanishes when there
 * is nothing to say leaves the screen shorter and the warning unmistakable when it returns.
 *
 * Where it goes depends on the same thing. With something missing it opens `/security/setup`, the
 * walkthrough that fixes it; otherwise `/profile/security`, which shows the whole picture. The
 * card that says "Set up recovery" should land on the setting up, not on a settings screen with
 * the setting up one tap further in.
 */

import Link from "next/link"
import { ChevronRight, Clock, ShieldAlert, ShieldCheck } from "lucide-react"

import { useAuth } from "@/hooks/useAuth"
import { MIN_GUARDIAN_QUORUM } from "@/lib/recovery"
import SettingsRow from "@/components/profile/settings-row"

function hoursLeft(ms: number): string {
  const hours = Math.ceil(ms / (60 * 60 * 1000))
  return hours <= 1 ? "within the hour" : `in ${hours} hours`
}

/** The three states, shared by both faces of this so they can never disagree. */
function useRecoveryState() {
  const { isAuthenticated, needsRecoveryFactor, recovery } = useAuth()

  const waiting = !recovery.ready && recovery.emailVerified && recovery.guardianReadyInMs !== null
  const needsAction = !recovery.ready && !waiting
  const guardianCount = `${recovery.activeGuardians} guardian${recovery.activeGuardians === 1 ? "" : "s"}`
  // Short of the quorum with nobody else on the way: the one case where the account has a
  // guardian and still cannot be recovered, so "add a guardian" would read as a mistake.
  const oneShort = !recovery.ready && recovery.emailVerified && recovery.activeGuardians > 0

  const summary = recovery.ready
    ? `On. Backup email and ${guardianCount}.`
    : waiting
      ? `Almost. Your guardian can help ${hoursLeft(recovery.guardianReadyInMs ?? 0)}.`
      : needsRecoveryFactor
        ? "Off. Losing your phone number would lose this account."
        : !recovery.emailVerified
          ? "Not ready. Add a backup email — every recovery starts there."
          : oneShort
            ? `Not ready. A recovery needs ${MIN_GUARDIAN_QUORUM} guardians to agree — add one more.`
            : `Not ready. Add ${MIN_GUARDIAN_QUORUM} guardians — a backup email alone can't recover this account.`

  return {
    isAuthenticated,
    needsRecoveryFactor,
    ready: recovery.ready,
    waiting,
    needsAction,
    summary,
    // Where it goes depends on the same thing. With something missing it opens the walkthrough
    // that fixes it; otherwise the screen that shows the whole picture. A card that says "Set up
    // recovery" should land on the setting up, not on a settings screen with the setting up one
    // tap further in.
    href: needsAction ? "/security/setup" : "/profile/security",
  }
}

/** Top of the screen, and only when a factor is missing. Renders nothing otherwise. */
export function AccountRecoveryBanner() {
  const { isAuthenticated, needsAction, needsRecoveryFactor, summary, href } = useRecoveryState()

  if (!isAuthenticated || !needsAction) return null

  return (
    <Link
      href={href}
      className="block rounded-[2rem] border border-amber-300 bg-amber-50 p-5 transition-colors hover:bg-amber-100/70"
    >
      <div className="flex items-center gap-3">
        <span className="rounded-2xl bg-amber-100 p-2.5 shrink-0">
          <ShieldAlert className="w-5 h-5 text-amber-700" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-base font-bold tracking-tight">Account recovery</h3>
          <p className="mt-1 text-sm text-amber-900/80">{summary}</p>
        </div>
        <ChevronRight className="w-4 h-4 shrink-0 text-amber-700" />
      </div>

      <span className="mt-4 flex w-full items-center justify-center rounded-2xl bg-amber-600 py-3 text-sm font-semibold text-white">
        {needsRecoveryFactor ? "Set up recovery" : "Finish setting up recovery"}
      </span>
    </Link>
  )
}

/** The same fact as a line in the Security group, in every state including the loud one. */
export function AccountRecoveryRow() {
  const { isAuthenticated, ready, waiting, needsAction, summary, href } = useRecoveryState()

  if (!isAuthenticated) return null

  return (
    <SettingsRow
      icon={needsAction ? ShieldAlert : waiting ? Clock : ShieldCheck}
      iconClassName={
        needsAction
          ? "bg-amber-100 text-amber-700"
          : waiting
            ? "bg-zinc-100 text-zinc-500"
            : "bg-emerald-50 text-emerald-600"
      }
      label="Account recovery"
      // Silent while the banner is up. The banner is only ever on screen when `needsAction` is
      // true, and it prints this exact sentence — twice on one short screen reads as a bug, and
      // the row still carries the state on the right either way.
      description={needsAction ? undefined : summary}
      value={ready ? "On" : waiting ? "Almost" : "Off"}
      href={href}
    />
  )
}
