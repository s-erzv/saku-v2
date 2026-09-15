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
 * `?view=app` or `?view=web` pins the answer for the rest of the tab. It is the only way to look
 * at the app UI on a laptop without installing it.
 */

import { useSyncExternalStore } from "react"

export type AppMode = "app" | "web"

const VIEW_KEY = "saku_view"

function readMode(): AppMode {
  try {
    const forced = new URLSearchParams(window.location.search).get("view")
    if (forced === "app" || forced === "web") sessionStorage.setItem(VIEW_KEY, forced)
    const pinned = sessionStorage.getItem(VIEW_KEY)
    if (pinned === "app" || pinned === "web") return pinned
  } catch {
    // Storage blocked: fall through to detection.
  }

  const installed =
    window.matchMedia("(display-mode: standalone)").matches ||
    window.matchMedia("(display-mode: fullscreen)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  // Farcaster and Base open mini-apps in a native webview, which is an app surface, not a tab.
  const miniAppHost = "ReactNativeWebView" in window

  return installed || miniAppHost ? "app" : "web"
}

/** Nothing to listen to: a tab does not become installed while it is open. */
const noSubscription = () => () => {}

export function useAppMode(): AppMode | null {
  return useSyncExternalStore(noSubscription, readMode, () => null)
}
