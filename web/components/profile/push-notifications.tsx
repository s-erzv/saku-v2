"use client"

/**
 * The opt-in for browser push notifications, as one line in the Preferences group.
 *
 * A toggle the user reaches on purpose, not a permission prompt on first load — an unrequested
 * prompt is the reliable way to get permanently denied, and a denial cannot be undone from the
 * page, only from browser settings.
 *
 * It was a full card with a heading, a paragraph and a full-width button. As a row it says the
 * same thing in a line and shows its state on the right, which is the question anyone opening
 * this screen actually has: is it on?
 *
 * The awkward cases still get their sentence, under the row rather than in place of the control.
 * iOS is the main one and is called out rather than papered over: Safari only exposes the Push
 * API to a PWA that has actually been added to the home screen (16.4+), so in a normal iOS tab
 * there is nothing to turn on and no error worth showing — just an instruction.
 */

import { Bell, BellOff, Loader2, Share } from "lucide-react"
import { usePushNotifications } from "@/hooks/usePushNotifications"
import SettingsRow from "@/components/profile/settings-row"

/** Detects the iOS-in-a-tab case, where the fix is "install the app", not "grant permission". */
function isIosBrowser() {
  if (typeof navigator === "undefined") return false
  const ua = navigator.userAgent
  const isIos = /iPad|iPhone|iPod/.test(ua) || (ua.includes("Macintosh") && "ontouchend" in document)
  const installed =
    window.matchMedia("(display-mode: standalone)").matches ||
    (window.navigator as Navigator & { standalone?: boolean }).standalone === true
  return isIos && !installed
}

/** A switch, because a row's state belongs on the row and not behind a full-width button. */
function Switch({ on, busy, onToggle }: { on: boolean; busy: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label="Push notifications"
      disabled={busy}
      onClick={onToggle}
      className={`relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-50 ${
        on ? "bg-[#F0A353]" : "bg-black/15"
      }`}
    >
      <span
        className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-[left] ${
          on ? "left-[22px]" : "left-0.5"
        }`}
      />
      {busy && (
        <Loader2 className="absolute inset-0 m-auto w-3.5 h-3.5 animate-spin text-black/40" />
      )}
    </button>
  )
}

export default function PushNotifications() {
  const { status, isBusy, error, enable, disable } = usePushNotifications()

  if (status === "checking") return null

  const enabled = status === "enabled"
  const blocked = status === "unsupported" || status === "denied"

  const note =
    status === "unsupported"
      ? isIosBrowser()
        ? "On iPhone, tap Share → Add to Home Screen, then open Saku from there. Safari only allows notifications for an installed app."
        : "This browser doesn't support push notifications."
      : status === "denied"
        ? "Notifications are blocked for Saku. Allow them in your browser's site settings, then come back here."
        : null

  return (
    <div>
      <SettingsRow
        icon={enabled ? Bell : BellOff}
        iconClassName={enabled ? "bg-orange-50 text-[#F0A353]" : "bg-black/[0.04] text-black/40"}
        label="Push notifications"
        description="Money arriving and off-ramps completing, on this device."
        value={blocked ? "Unavailable" : undefined}
        trailing={
          blocked ? undefined : (
            <Switch on={enabled} busy={isBusy} onToggle={() => (enabled ? disable() : enable())} />
          )
        }
      />

      {note && (
        <p className="mx-3 mb-2 flex items-start gap-2 rounded-xl bg-black/[0.03] px-3 py-2.5 text-[11px] leading-snug text-black/45">
          {status === "unsupported" && isIosBrowser() && <Share className="w-3.5 h-3.5 shrink-0 mt-px" />}
          <span>{note}</span>
        </p>
      )}

      {error && <p className="mx-3 mb-2 text-[11px] font-medium text-red-600">{error}</p>}
    </div>
  )
}
