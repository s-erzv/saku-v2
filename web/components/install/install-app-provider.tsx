"use client"

import Image from "next/image"
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react"
import { Download, MoreVertical, Share2, X } from "lucide-react"
import { isInstalledAppSurface } from "@/components/web/app-mode"
import {
  INSTALL_PROMPT_COOLDOWN_MS,
  installPromptCooldownRemaining,
  isPhoneUserAgent,
  shouldOfferInstall,
} from "@/lib/install-app"

const MOBILE_VIEWPORT = "(max-width: 767px)"
const COOLDOWN_KEY = "saku_install_prompt_dismissed_until"
const INSTALLED_KEY = "saku_app_installed"

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>
}

interface InstallAppContextValue {
  canInstall: boolean
  requestInstall: () => Promise<void>
}

const InstallAppContext = createContext<InstallAppContextValue | null>(null)

function subscribeEnvironment(onChange: () => void) {
  const media = window.matchMedia(MOBILE_VIEWPORT)
  media.addEventListener("change", onChange)
  window.addEventListener("appinstalled", onChange)
  return () => {
    media.removeEventListener("change", onChange)
    window.removeEventListener("appinstalled", onChange)
  }
}

function mobileBrowserEligible() {
  const nav = navigator as Navigator & { userAgentData?: { mobile?: boolean } }
  return shouldOfferInstall({
    phone: isPhoneUserAgent(nav.userAgent, nav.userAgentData?.mobile),
    mobileViewport: window.matchMedia(MOBILE_VIEWPORT).matches,
    installedSurface: isInstalledAppSurface(),
  })
}

function readCooldown() {
  try {
    const value = Number(localStorage.getItem(COOLDOWN_KEY))
    return Number.isFinite(value) && value > 0 ? value : 0
  } catch {
    return 0
  }
}

function readInstalled() {
  try {
    return localStorage.getItem(INSTALLED_KEY) === "1"
  } catch {
    return false
  }
}

function rememberInstalled(installed: boolean) {
  try {
    if (installed) localStorage.setItem(INSTALLED_KEY, "1")
    else localStorage.removeItem(INSTALLED_KEY)
  } catch {
    // Browser state still controls the current tab when storage is unavailable.
  }
}

function isIosPhone() {
  return /iPhone|iPod/i.test(navigator.userAgent)
}

export function useInstallApp() {
  const value = useContext(InstallAppContext)
  if (!value) throw new Error("useInstallApp must be used within InstallAppProvider")
  return value
}

export default function InstallAppProvider({ children }: { children: ReactNode }) {
  const eligible = useSyncExternalStore(subscribeEnvironment, mobileBrowserEligible, () => false)
  const [installEvent, setInstallEvent] = useState<BeforeInstallPromptEvent | null>(null)
  const [installed, setInstalled] = useState(false)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [showGuide, setShowGuide] = useState(false)
  const [cooldownUntil, setCooldownUntil] = useState<number | null>(null)

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const installedSurface = isInstalledAppSurface()
      if (installedSurface) rememberInstalled(true)
      setInstalled(installedSurface || readInstalled())
      setCooldownUntil(readCooldown())
    })
    return () => cancelAnimationFrame(frame)
  }, [])

  const dismiss = useCallback(() => {
    const until = Date.now() + INSTALL_PROMPT_COOLDOWN_MS
    try {
      localStorage.setItem(COOLDOWN_KEY, String(until))
    } catch {
      // Current tab still respects the cooldown when storage is unavailable.
    }
    setCooldownUntil(until)
    setDialogOpen(false)
    setShowGuide(false)
  }, [])

  useEffect(() => {
    if (!eligible || installed || cooldownUntil === null) return
    const timer = window.setTimeout(() => {
      setDialogOpen(true)
      setShowGuide(false)
    }, installPromptCooldownRemaining(cooldownUntil))
    return () => window.clearTimeout(timer)
  }, [eligible, installed, cooldownUntil])

  useEffect(() => {
    const onBeforeInstall = (rawEvent: Event) => {
      const event = rawEvent as BeforeInstallPromptEvent
      event.preventDefault()
      // A fresh native event means a remembered installation was removed and is installable again.
      rememberInstalled(false)
      setInstalled(false)
      setInstallEvent(event)
    }
    const onInstalled = () => {
      rememberInstalled(true)
      setInstalled(true)
      setInstallEvent(null)
      setDialogOpen(false)
    }

    window.addEventListener("beforeinstallprompt", onBeforeInstall)
    window.addEventListener("appinstalled", onInstalled)
    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstall)
      window.removeEventListener("appinstalled", onInstalled)
    }
  }, [])

  useEffect(() => {
    if (!dialogOpen) return
    const previousOverflow = document.body.style.overflow
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") dismiss()
    }
    document.body.style.overflow = "hidden"
    window.addEventListener("keydown", onKeyDown)
    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener("keydown", onKeyDown)
    }
  }, [dialogOpen, dismiss])

  const canInstall = eligible && !installed

  const requestInstall = useCallback(async () => {
    if (!eligible || installed) return
    if (!installEvent) {
      setShowGuide(true)
      setDialogOpen(true)
      return
    }

    setDialogOpen(false)
    try {
      await installEvent.prompt()
      const choice = await installEvent.userChoice
      setInstallEvent(null)
      if (choice.outcome === "accepted") {
        rememberInstalled(true)
        setInstalled(true)
      } else dismiss()
    } catch {
      setInstallEvent(null)
      setShowGuide(true)
      setDialogOpen(true)
    }
  }, [dismiss, eligible, installEvent, installed])

  const ios = eligible && isIosPhone()

  return (
    <InstallAppContext.Provider value={{ canInstall, requestInstall }}>
      {children}

      {canInstall && dialogOpen && (
        <div className="fixed inset-0 z-[120] flex items-end justify-center p-3 pb-[max(12px,env(safe-area-inset-bottom))] sm:items-center">
          <button
            type="button"
            aria-label="Close install prompt"
            onClick={dismiss}
            className="absolute inset-0 bg-black/40 backdrop-blur-[2px]"
          />

          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="install-app-title"
            className="relative w-full max-w-sm rounded-[28px] bg-[#FFFEFC] p-5 shadow-[0_28px_80px_rgb(20_18_14/0.28)] ring-1 ring-black/[0.06] animate-in fade-in slide-in-from-bottom-3 duration-200"
          >
            <div className="flex items-start gap-3.5">
              <Image
                src="/icons/icon-192.png"
                width={52}
                height={52}
                alt=""
                className="h-13 w-13 shrink-0 rounded-[16px]"
              />
              <div className="min-w-0 flex-1 pt-0.5">
                <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-black/35">Saku app</p>
                <h2 id="install-app-title" className="mt-1 text-[21px] font-semibold leading-tight tracking-tight text-ink">
                  {showGuide ? "Add Saku to your home screen" : "Keep Saku one tap away"}
                </h2>
              </div>
              <button
                type="button"
                onClick={dismiss}
                aria-label="Not now"
                className="-mr-1 -mt-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-black/40 transition-colors hover:bg-black/[0.05] hover:text-ink"
              >
                <X className="h-4.5 w-4.5" />
              </button>
            </div>

            {showGuide ? (
              <div className="mt-5 rounded-[18px] bg-black/[0.035] p-4">
                <div className="flex gap-3">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white text-xs font-semibold ring-1 ring-black/[0.06]">1</span>
                  <p className="pt-1 text-[13px] leading-snug text-black/65">
                    {ios ? "Tap Share in your browser toolbar." : "Open your browser menu."}
                  </p>
                  {ios ? <Share2 className="ml-auto h-4 w-4 shrink-0 text-black/35" /> : <MoreVertical className="ml-auto h-4 w-4 shrink-0 text-black/35" />}
                </div>
                <div className="mt-3 flex gap-3">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white text-xs font-semibold ring-1 ring-black/[0.06]">2</span>
                  <p className="pt-1 text-[13px] leading-snug text-black/65">
                    Choose <span className="font-semibold text-ink">{ios ? "Add to Home Screen" : "Install app"}</span>, then confirm.
                  </p>
                </div>
              </div>
            ) : (
              <p className="mt-4 text-[14px] leading-relaxed text-black/55">
                Open your wallet full-screen from your home screen. No app store, no second account.
              </p>
            )}

            <div className="mt-5 space-y-2">
              <button
                type="button"
                onClick={showGuide ? dismiss : () => void requestInstall()}
                className="flex w-full items-center justify-center gap-2 rounded-2xl bg-ink px-4 py-3.5 text-[14px] font-semibold text-white transition-opacity hover:opacity-90 active:scale-[0.99]"
              >
                {!showGuide && <Download className="h-4 w-4" />}
                {showGuide ? "Got it" : installEvent ? "Install Saku" : "See install steps"}
              </button>
              {!showGuide && (
                <button
                  type="button"
                  onClick={dismiss}
                  className="w-full rounded-xl py-2 text-[13px] font-medium text-black/40 transition-colors hover:text-ink"
                >
                  Not now
                </button>
              )}
            </div>
          </section>
        </div>
      )}
    </InstallAppContext.Provider>
  )
}
