"use client"

import { useRouter, usePathname } from "next/navigation"
import { Home, QrCode, Receipt, TrendingUp, User } from "lucide-react"
import { useCallback, useEffect, useRef, useState } from "react"

import { useAuth } from "@/hooks/useAuth"
import PaySheet from "@/components/pay/pay-sheet"

type NavItem = {
  label: string
  icon: React.ElementType
  path: string
  /** False while the destination is still being rebuilt — renders dimmed and inert. */
  ready: boolean
  /**
   * Marks a tab as carrying something unfinished, drawn as a dot on its icon.
   *
   * Only one tab uses it, and only for one thing: recovery not yet set up. That narrowness is
   * the point. A dot that can mean four things is a dot nobody reads, and this one has to keep
   * working for the months an account may sit one lost SIM away from being gone — so it means
   * exactly what the amber card inside Profile means, and goes out the moment that card does.
   */
  alert?: (state: { recoveryReady: boolean }) => boolean
}

// The v1 bar, restored exactly: Home, History, the QR Pay button in the middle, Earn, Profile.
//
// `ready` marks the destinations that exist. A tab that navigates to a route that is not there
// yet is worse than one that says "soon".
const leftItems: NavItem[] = [
  { label: "Home", icon: Home, path: "/home", ready: true },
  { label: "History", icon: Receipt, path: "/transactions", ready: true },
]

const rightItems: NavItem[] = [
  { label: "Earn", icon: TrendingUp, path: "/staking", ready: true },
  {
    label: "Profile",
    icon: User,
    path: "/profile",
    ready: true,
    alert: ({ recoveryReady }) => !recoveryReady,
  },
]

const ALERT_RED = "#DC2626"

function useRipple() {
  const [ripples, setRipples] = useState<{ x: number; y: number; id: number }[]>([])

  const trigger = useCallback((e: React.MouseEvent<HTMLElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top
    const id = Date.now()
    setRipples((prev) => [...prev, { x, y, id }])
    setTimeout(() => setRipples((prev) => prev.filter((r) => r.id !== id)), 600)
  }, [])

  return { ripples, trigger }
}

function NavItemButton({ item }: { item: NavItem }) {
  const router = useRouter()
  const pathname = usePathname()
  const active = pathname === item.path
  const { ripples, trigger } = useRipple()
  const { isAuthenticated, recovery } = useAuth()

  // Nothing to flag before the account is known. Showing the dot while `recovery` is still at its
  // empty default would light it up for a second on every cold load, including for people whose
  // recovery is perfectly fine.
  const alerting = isAuthenticated && (item.alert?.({ recoveryReady: recovery.ready }) ?? false)

  return (
    <button
      onClick={(e) => {
        if (!item.ready) return
        trigger(e)
        router.push(item.path)
      }}
      disabled={!item.ready}
      title={item.ready ? undefined : "Coming soon"}
      aria-label={alerting ? `${item.label} — needs your attention` : item.label}
      aria-current={active ? "page" : undefined}
      className="relative flex flex-col items-center justify-center gap-1 w-full h-full overflow-hidden select-none disabled:opacity-40"
      style={{ WebkitTapHighlightColor: "transparent" }}
    >
      {ripples.map(({ x, y, id }) => (
        <span
          key={id}
          className="pointer-events-none absolute rounded-full bg-black/5 animate-ripple"
          style={{ left: x - 20, top: y - 20, width: 40, height: 40 }}
        />
      ))}

      <span
        className="relative flex items-center justify-center rounded-2xl transition-all duration-300 ease-out"
        style={{
          width: 42,
          height: 32,
          backgroundColor: active ? "rgba(240,163,83,0.12)" : "transparent",
          transform: active ? "scale(1.05)" : "scale(1)",
        }}
      >
        <item.icon
          size={20}
          strokeWidth={active ? 2.5 : 1.8}
          className="transition-all duration-300"
          style={{ color: active ? "var(--color-secondary, #F0A353)" : "rgba(0,0,0,0.35)" }}
        />

        {/* The notification red everyone already reads as "deal with this". It is the loudest
            colour on the bar, which is the right weight for the one thing on it that can cost
            someone their whole account — and it will not be confused with the orange the active
            tab is painted in. The ring keeps it legible where it overlaps the icon's strokes. */}
        {alerting && (
          <span
            aria-hidden
            className="absolute top-0.5 right-1.5 h-2 w-2 rounded-full ring-2 ring-white"
            style={{ backgroundColor: ALERT_RED }}
          />
        )}
        {active && (
          <span
            className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-[var(--color-secondary,#F0A353)]"
            style={{ boxShadow: "0 0 6px rgba(240,163,83,0.8)" }}
          />
        )}
      </span>

      <span
        className="text-[10px] font-semibold tracking-wide transition-all duration-300"
        style={{ color: active ? "var(--color-secondary, #F0A353)" : "rgba(0,0,0,0.4)" }}
      >
        {item.label}
      </span>
    </button>
  )
}

function PayButton({ active, onOpen }: { active: boolean; onOpen: () => void }) {
  const [pressed, setPressed] = useState(false)
  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const handlePointerDown = () => {
    setPressed(true)
    pressTimer.current = setTimeout(() => setPressed(false), 200)
  }

  useEffect(() => {
    return () => {
      if (pressTimer.current) clearTimeout(pressTimer.current)
    }
  }, [])

  return (
    <div className="relative flex flex-col items-center justify-center h-full">
      <div className="absolute -top-8 flex flex-col items-center">
        <span
          className="absolute inset-0 m-auto rounded-full transition-all duration-500 pointer-events-none"
          style={{
            width: 72,
            height: 72,
            top: 0,
            background: "radial-gradient(circle, rgba(255,211,98,0.25) 0%, transparent 70%)",
            opacity: pressed ? 0.8 : 1,
          }}
        />

        <button
          onClick={onOpen}
          onPointerDown={handlePointerDown}
          aria-label="Pay"
          className="relative flex items-center justify-center rounded-full border-[5px] border-white transition-all duration-200 select-none"
          style={{
            width: 62,
            height: 62,
            background: "linear-gradient(135deg, #FFD364 0%, #F0A353 100%)",
            boxShadow: pressed
              ? "0 4px 12px rgba(240,163,83,0.4)"
              : "0 8px 24px rgba(240,163,83,0.3), 0 2px 6px rgba(240,163,83,0.2)",
            transform: pressed ? "scale(0.92)" : "scale(1)",
            WebkitTapHighlightColor: "transparent",
          }}
        >
          <QrCode
            size={26}
            strokeWidth={2.5}
            className="text-white transition-transform duration-200"
            style={{ transform: pressed ? "rotate(6deg) scale(0.95)" : "rotate(0deg) scale(1)" }}
          />
          <span className="absolute inset-0 rounded-full overflow-hidden pointer-events-none">
            <span
              className="absolute inset-0 rounded-full"
              style={{
                background: "linear-gradient(120deg, rgba(255,255,255,0) 30%, rgba(255,255,255,0.25) 50%, rgba(255,255,255,0) 70%)",
              }}
            />
          </span>
        </button>

        <span
          className="mt-1 text-[10px] font-semibold tracking-wide transition-colors duration-300"
          style={{ color: active ? "var(--color-secondary, #F0A353)" : "rgba(0,0,0,0.4)" }}
        >
          Pay
        </span>
      </div>
    </div>
  )
}

interface BottomNavigationProps {
  /**
   * Start with the Pay sheet already open. Only `/pay` passes it, so that the path still works
   * as a destination — links already sent, a bookmark, anything deep-linking into paying — with
   * the bar under it and no second copy of the sheet's UI kept alive to drift out of step.
   *
   * A prop and not a query parameter read on mount: the server and the client are handed the
   * same value, so there is no hydration mismatch and no effect writing state on arrival.
   */
  initialPayOpen?: boolean
}

export default function BottomNavigation({ initialPayOpen = false }: BottomNavigationProps) {
  // Pay is a sheet over the current screen rather than a route of its own, so the bar, and the
  // screen behind it, both stay put — see `components/pay/pay-sheet.tsx`. Because this bar is
  // rendered by every screen that has one, the sheet is reachable from all of them without any
  // of them knowing about it.
  const [payOpen, setPayOpen] = useState(initialPayOpen)
  const router = useRouter()
  const pathname = usePathname()

  const closePay = () => {
    setPayOpen(false)
    // Dismissing the sheet on `/pay` would otherwise leave the user on a page that is nothing
    // but a backdrop for it.
    if (pathname === "/pay") router.replace("/home")
  }

  return (
    <>
      <PaySheet open={payOpen} onClose={closePay} />

      <style>{`
        @keyframes ripple {
          from { transform: scale(0); opacity: 0.5; }
          to   { transform: scale(6); opacity: 0; }
        }
        .animate-ripple { animation: ripple 0.55s cubic-bezier(0.2, 0, 0.6, 1) forwards; }
      `}</style>

      <div className="h-24 pointer-events-none" aria-hidden />

      <div className="fixed bottom-0 left-0 right-0 z-50 flex justify-center pointer-events-none px-4">
        <div
          className="relative w-full max-w-lg pointer-events-auto"
          style={{
            background: "rgba(255,255,255,0.85)",
            backdropFilter: "blur(20px) saturate(180%)",
            WebkitBackdropFilter: "blur(20px) saturate(180%)",
            borderTop: "1px solid rgba(255,255,255,0.8)",
            borderRadius: "28px 28px 0 0",
            boxShadow: "0 -4px 24px rgba(0,0,0,0.06)",
            paddingBottom: "env(safe-area-inset-bottom, 0px)",
          }}
        >
          <span
            className="absolute inset-0 pointer-events-none opacity-[0.02] rounded-[28px_28px_0_0] overflow-hidden"
            style={{
              backgroundImage: "url(\"data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")",
              backgroundSize: "128px 128px",
            }}
          />

          <nav
            className="grid items-center"
            style={{
              // One column per child: two tabs, the raised Pay button, two more tabs. This has
              // to match the number of items rendered below — when it did not, the extra tabs
              // wrapped onto a second row and overlapped the first.
              gridTemplateColumns: "1fr 1fr 80px 1fr 1fr",
              height: 68,
            }}
          >
            {leftItems.map((item) => (
              <NavItemButton key={item.path} item={item} />
            ))}

            <PayButton active={payOpen} onOpen={() => setPayOpen(true)} />

            {rightItems.map((item) => (
              <NavItemButton key={item.path} item={item} />
            ))}
          </nav>
        </div>
      </div>
    </>
  )
}