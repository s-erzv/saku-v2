"use client"

/**
 * The opt-in for browser push notifications.
 *
 * A toggle the user reaches on purpose, not a permission prompt on first load — an unrequested
 * prompt is the reliable way to get permanently denied, and a denial cannot be undone from the
 * page, only from browser settings.
 *
 * iOS is the awkward case and is called out rather than papered over: Safari only exposes the
 * Push API to a PWA that has actually been added to the home screen (16.4+), so in a normal iOS
 * tab there is nothing to turn on and no error worth showing — just an instruction.
 */

import { Bell, BellOff, Loader2, Share } from "lucide-react"
import { usePushNotifications } from "@/hooks/usePushNotifications"

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

export default function PushNotifications() {
  const { status, isBusy, error, enable, disable } = usePushNotifications()

  if (status === "checking") return null

  const enabled = status === "enabled"

  return (
    <div className="bg-white rounded-[2rem] border border-border/50 p-6 shadow-sm space-y-4">
      <div className="flex items-start gap-3">
        <div className={`rounded-2xl p-2.5 ${enabled ? "bg-orange-50" : "bg-black/[0.04]"}`}>
          {enabled ? (
            <Bell className="w-5 h-5 text-[#F0A353]" />
          ) : (
            <BellOff className="w-5 h-5 text-black/40" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="text-base font-bold tracking-tight">Push notifications</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            For money arriving and off-ramps completing, on this device.
          </p>
        </div>
      </div>

      {status === "unsupported" ? (
        isIosBrowser() ? (
          <p className="flex items-start gap-2 text-xs text-black/45 bg-black/[0.03] rounded-2xl px-4 py-3">
            <Share className="w-4 h-4 shrink-0 mt-px" />
            <span>
              On iPhone, tap Share → <span className="font-semibold">Add to Home Screen</span>, then
              open Saku from there. Safari only allows notifications for an installed app.
            </span>
          </p>
        ) : (
          <p className="text-xs text-black/45 bg-black/[0.03] rounded-2xl px-4 py-3">
            This browser doesn&apos;t support push notifications.
          </p>
        )
      ) : status === "denied" ? (
        <p className="text-xs text-black/45 bg-black/[0.03] rounded-2xl px-4 py-3">
          Notifications are blocked for Saku. Allow them in your browser&apos;s site settings, then
          come back here.
        </p>
      ) : (
        <button
          onClick={() => (enabled ? disable() : enable())}
          disabled={isBusy}
          className={`w-full flex items-center justify-center gap-2 py-3.5 rounded-2xl text-sm font-bold transition-all active:scale-[0.98] disabled:opacity-50 ${
            enabled ? "bg-black/[0.05] text-black" : "bg-black text-white"
          }`}
        >
          {isBusy && <Loader2 className="w-4 h-4 animate-spin" />}
          {enabled ? "Turn off on this device" : "Turn on notifications"}
        </button>
      )}

      {error && <p className="text-xs font-medium text-red-600">{error}</p>}
    </div>
  )
}
