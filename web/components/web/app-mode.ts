"use client"

/**
 * Which Saku this is: the installed app, or the website.
 *
 * Installed — a home-screen PWA, or a mini-app host's native webview — gets the phone UI the app
 * was built as. A browser tab gets the web wallet, on a phone or on a desktop. The line is drawn
 * at installation rather than at screen width on purpose: someone who installed Saku expects the
 * app, and someone who typed the address expects a website, whatever the device.
 *
 * Read through `useSyncExternalStore` so the server render (which cannot know) and the first
 * client render agree on `null`, and the real answer lands on the very next commit. Screens wait
 * behind their loading state until then, so neither UI flashes before the other.
 *
 * The /app route wins over every override. An installed surface also wins over a stale ?view=web
 * override. In a regular tab, ?view=app or ?view=web pins the answer for the rest of that tab.
 */

import { useSyncExternalStore } from "react"

export type AppMode = "app" | "web"

export const APP_HOME = "/app/home"
export const WEB_HOME = "/home"

const VIEW_KEY = "saku_view"

/** Actual installed/native host state, independent from a temporary `?view=app` override. */
export function isInstalledAppSurface(): boolean {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    window.matchMedia("(display-mode: fullscreen)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true ||
    "ReactNativeWebView" in window
  )
}

function readMode(): AppMode {
  // The app URL also carries app context through sign-in and shared feature routes.
  if (window.location.pathname === APP_HOME || window.location.pathname.startsWith("/app/")) {
    try { sessionStorage.setItem(VIEW_KEY, "app") } catch { /* Storage may be blocked. */ }
    return "app"
  }

  // Farcaster and Base open mini-apps in a native webview, which is an app surface, not a tab.
  if (isInstalledAppSurface()) {
    try { sessionStorage.setItem(VIEW_KEY, "app") } catch { /* Storage may be blocked. */ }
    return "app"
  }

  try {
    const forced = new URLSearchParams(window.location.search).get("view")
    if (forced === "app" || forced === "web") sessionStorage.setItem(VIEW_KEY, forced)
    const pinned = sessionStorage.getItem(VIEW_KEY)
    if (pinned === "app" || pinned === "web") return pinned
  } catch {
    // Storage blocked: use browser mode.
  }

  return "web"
}

/** Use at navigation time, after hydration, so shared flows return to the right Home. */
export function homeHref(): typeof APP_HOME | typeof WEB_HOME {
  return readMode() === "app" ? APP_HOME : WEB_HOME
}

/** Nothing to listen to: a tab does not become installed while it is open. */
const noSubscription = () => () => {}

export function useAppMode(): AppMode | null {
  return useSyncExternalStore(noSubscription, readMode, () => null)
}
