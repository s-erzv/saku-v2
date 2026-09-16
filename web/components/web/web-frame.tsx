"use client"

/**
 * The web wallet: what Saku looks like in a browser tab.
 *
 * Mounted once, in the root layout, around every screen. In the installed app — and on any route
 * outside the signed-in wallet — it adds nothing that affects layout, so the phone UI renders
 * exactly as it did before this existed.
 *
 * In a tab it lays the same screens out as a desktop wallet: pages along the top, a rail of tools
 * down the right, and a panel that opens beside the rail with the tool in it. The tools are the
 * app's own screens, rendered unchanged inside the panel (`shell.tsx` is how a screen finds out
 * it is there), so no flow has a second implementation to drift out of step with the first.
 *
 * Below `lg` the same pieces rearrange rather than disappear: the rail becomes a dock along the
 * bottom and the panel covers the screen.
 *
 * ## Why the tree never changes shape
 *
 * The same wrappers render in both modes with only their classes and attributes switched.
 * Whether this is the web wallet is not known until after hydration (`app-mode.ts`) and until
 * the session has loaded, and swapping wrappers around `children` at that moment would remount
 * the whole screen — every fetch fired twice, any half-typed form thrown away.
 */

import { createElement, useEffect, useMemo, useRef, useState, type ComponentType, type ReactNode } from "react"
import dynamic from "next/dynamic"
import Link from "next/link"
import { usePathname } from "next/navigation"
import {
  ArrowSquareOut,
  Bell,
  CaretDoubleLeft,
  CaretDoubleRight,
  CaretDown,
  CaretRight,
  Check,
  Copy,
  QrCode,
  ShieldCheck,
  SignOut,
  UserCircle,
  X,
  type Icon,
} from "@phosphor-icons/react"
import { Loader2 } from "lucide-react"
import { useAuth } from "@/hooks/useAuth"
import { useMpcWallet } from "@/hooks/useMpcWallet"
import { useNotifications } from "@/hooks/useNotifications"
import { useTokenBalances } from "@/hooks/useTokenBalances"
import { CONTRACTS, NETWORK_CONFIG, explorerAddressUrl } from "@/lib/config"
import IconTile from "@/components/ui/icon-tile"
import ProfileAvatar from "@/components/ui/profile-avatar"
import { useAppMode } from "@/components/web/app-mode"
import ReceiveDialog from "@/components/web/receive-dialog"
import {
  InPanelContext,
  RECEIVE,
  TOOLS,
  WebShellContext,
  useWebShell,
  type ToolId,
  type WebShell,
} from "@/components/web/shell"

const NAV = [
  { href: "/home", label: "Home" },
  { href: "/transactions", label: "Activity" },
  { href: "/profile", label: "Profile" },
]

/**
 * The signed-in wallet. Everything else — the landing page, sign-in, the recovery setup and the
 * guardian screens — is a full-screen flow of its own and stays out of the frame.
 */
const APP_ROUTES = [
  "/home",
  "/transactions",
  "/profile",
  "/notifications",
  "/transfer",
  "/topup",
  "/offramp",
  "/staking",
  "/packet",
  "/split-bill",
  "/pay",
]

/** Pages with a web layout of their own. The rest are shown as a single sheet on the canvas. */
const WIDE_ROUTES = ["/home", "/transactions", "/profile"]

const isUnder = (pathname: string, route: string) => pathname === route || pathname.startsWith(`${route}/`)

function PanelLoading() {
  return (
    <div className="flex h-48 items-center justify-center">
      <Loader2 className="h-6 w-6 animate-spin text-black/20" />
    </div>
  )
}

// Loaded when first opened, not with the frame: most visits open one tool, if any.
const SCREENS: Record<Exclude<ToolId, "pay">, ComponentType> = {
  transfer: dynamic(() => import("@/app/transfer/page"), { loading: PanelLoading }),
  topup: dynamic(() => import("@/app/topup/page"), { loading: PanelLoading }),
  withdraw: dynamic(() => import("@/app/offramp/page"), { loading: PanelLoading }),
  packet: dynamic(() => import("@/app/packet/page"), { loading: PanelLoading }),
  "split-bill": dynamic(() => import("@/app/split-bill/page"), { loading: PanelLoading }),
  earn: dynamic(() => import("@/app/staking/page"), { loading: PanelLoading }),
}

const PaySheet = dynamic(() => import("@/components/pay/pay-sheet"), { loading: PanelLoading })

interface PanelState {
  tool: ToolId
  /** The route the panel belongs to. */
  at: string
  /** Whether the page has been on `at` since the panel opened. */
  seen: boolean
}

export default function AppFrame({ children }: { children: ReactNode }) {
  const mode = useAppMode()
  const pathname = usePathname()
  const { isAuthenticated, wallet } = useAuth()
  const { address } = useMpcWallet()
  const walletAddress = address ?? wallet?.address ?? null

  const web = mode === "web" && isAuthenticated && APP_ROUTES.some((route) => isUnder(pathname, route))

  const [panel, setPanel] = useState<PanelState | null>(null)
  const [version, setVersion] = useState(0)
  const [receiving, setReceiving] = useState(false)

  // A panel belongs to the page it was opened on, and leaving that page closes it. Adjusted during
  // render rather than in an effect, so there is no frame where it shows over the wrong page and
  // it cannot come back on its own when the user returns. `seen` is what lets `/pay` open a panel
  // on Home before the redirect has arrived there.
  if (panel && !panel.seen && panel.at === pathname) setPanel({ ...panel, seen: true })
  if (panel && panel.seen && panel.at !== pathname) setPanel(null)

  const activeTool = web && panel?.at === pathname ? panel.tool : null

  const shell = useMemo<WebShell | null>(
    () =>
      web
        ? {
            activeTool,
            version,
            openTool: (tool, at) => setPanel({ tool, at: at ?? pathname, seen: (at ?? pathname) === pathname }),
            closeTool: () => {
              setPanel(null)
              setVersion((v) => v + 1)
            },
            openReceive: () => setReceiving(true),
          }
        : null,
    [web, activeTool, version, pathname]
  )

  const wide = WIDE_ROUTES.includes(pathname)

  return (
    <WebShellContext.Provider value={shell}>
      <div
        data-app-surface={mode === "app" ? "" : undefined}
        className={web ? "min-h-dvh w-full min-w-0 max-w-full overflow-x-clip bg-canvas font-sans text-ink" : "min-h-dvh w-full min-w-0 max-w-full overflow-x-clip"}
      >
        {shell ? <WebNavbar pathname={pathname} walletAddress={walletAddress} version={version} /> : null}

        <div className={web ? "lg:flex lg:items-start" : undefined}>
          <div
            data-web-surface={web ? "" : undefined}
            data-web-sheet={web && !wide ? "" : undefined}
            className={web ? `min-w-0 flex-1 pb-28 lg:pb-12 ${wide ? "" : "px-4 pt-6 sm:px-6 lg:pt-10"}` : undefined}
          >
            {children}
          </div>

          {shell && activeTool ? <ToolPanel tool={activeTool} shell={shell} /> : null}
          {shell ? <ToolRail pathname={pathname} shell={shell} /> : null}
        </div>
      </div>

      {shell && receiving ? <ReceiveDialog address={walletAddress} onClose={() => setReceiving(false)} /> : null}
    </WebShellContext.Provider>
  )
}

/* ------------------------------------------------------------------------------------ top bar */

function WebNavbar({
  pathname,
  walletAddress,
  version,
}: {
  pathname: string
  walletAddress: string | null
  version: number
}) {
  const { unreadCount, refresh } = useNotifications()
  const [menuOpen, setMenuOpen] = useState(false)

  // The frame outlives every page, so nothing remounts to re-read the count the way the app's
  // header does on each screen. Re-reading on navigation keeps the dot honest after Notifications
  // marks everything read. The first path is skipped; the hook has just read it.
  const lastPath = useRef(pathname)
  useEffect(() => {
    if (lastPath.current === pathname) return
    lastPath.current = pathname
    void refresh()
  }, [pathname, refresh])

  const links = NAV.map((item) => {
    const active = isUnder(pathname, item.href)
    return (
      <Link
        key={item.href}
        href={item.href}
        aria-current={active ? "page" : undefined}
        className={`shrink-0 rounded-full px-4 py-2 text-[14px] font-medium transition-colors ${
          active ? "bg-black/[0.055] text-ink" : "text-black/55 hover:text-ink"
        }`}
      >
        {item.label}
      </Link>
    )
  })

  return (
    // Solid, not frosted: a backdrop filter here would become the containing block for the account
    // menu's full-screen click-catcher and shrink it to the height of the bar.
    <header className={`relative border-b border-black/[0.06] bg-white pt-[env(safe-area-inset-top)] lg:sticky lg:top-0 lg:pt-0 ${menuOpen ? "z-50" : "z-30"}`}>
      <div className="flex h-16 items-center gap-2 px-4 sm:px-6">
        <Link href="/home" className="mr-2 flex shrink-0 items-center gap-2.5 lg:mr-6">
          <img src="/icons/saku-mark.png" alt="" className="h-9 w-9" />
          <span className="text-[19px] font-semibold tracking-tight">Saku</span>
        </Link>

        <nav aria-label="Pages" className="hidden items-center gap-1 lg:flex">
          {links}
        </nav>

        <div className="ml-auto flex items-center gap-1.5">
          <AccountMenu
            walletAddress={walletAddress}
            pathname={pathname}
            version={version}
            open={menuOpen}
            onOpenChange={setMenuOpen}
          />
          <Link
            href="/notifications"
            aria-label={unreadCount > 0 ? `Notifications, ${unreadCount} unread` : "Notifications"}
            className="relative flex h-10 w-10 items-center justify-center rounded-full text-black/65 transition-colors hover:bg-black/[0.05] hover:text-ink"
          >
            <Bell size={21} />
            {unreadCount > 0 && (
              <span className="absolute right-2.5 top-2.5 h-2 w-2 rounded-full bg-negative ring-2 ring-white" />
            )}
          </Link>
        </div>
      </div>

      <nav aria-label="Pages" className="flex max-w-sm gap-1 overflow-hidden px-4 pb-2.5 sm:px-6 lg:hidden">
        {links}
      </nav>
    </header>
  )
}

/* ------------------------------------------------------------------------------- account menu */

function AccountMenu({
  walletAddress,
  pathname,
  version,
  open,
  onOpenChange,
}: {
  walletAddress: string | null
  pathname: string
  version: number
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { user, logout } = useAuth()
  const shell = useWebShell()
  const { balances, refresh } = useTokenBalances(walletAddress)
  const [copied, setCopied] = useState(false)

  // Same reasoning as the notification count: the bar never remounts, so it re-reads the balance
  // when the page changes or a tool panel closes — the two moments money may have moved.
  const lastRead = useRef(`${pathname}|${version}`)
  useEffect(() => {
    const key = `${pathname}|${version}`
    if (lastRead.current === key) return
    lastRead.current = key
    void refresh()
  }, [pathname, version, refresh])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onOpenChange(false)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [open, onOpenChange])

  const usdc = balances.find((t) => t.address.toLowerCase() === CONTRACTS.USDC.toLowerCase())
  const balance = Number(usdc?.formatted ?? 0).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
  const short = walletAddress ? `${walletAddress.slice(0, 6)}…${walletAddress.slice(-4)}` : "Setting up…"
  const close = () => onOpenChange(false)

  const copy = async () => {
    if (!walletAddress) return
    await navigator.clipboard.writeText(walletAddress)
    setCopied(true)
    setTimeout(() => setCopied(false), 1800)
  }

  return (
    <div className="relative">
      <button
        onClick={() => onOpenChange(!open)}
        aria-expanded={open}
        aria-controls="account-menu"
        aria-label="Account"
        className="flex items-center gap-2.5 rounded-full border border-black/[0.08] bg-white py-1 pl-1 pr-2.5 transition-colors hover:border-black/20"
      >
        <ProfileAvatar src={user?.avatar_url} name={user?.display_name} className="h-8 w-8" textClassName="text-[11px]" />
        <span className="hidden text-left sm:block">
          <span className="block text-[13px] font-semibold leading-tight tabular-nums">${balance}</span>
          <span className="block font-mono text-[11px] leading-tight text-black/45">{short}</span>
        </span>
        <CaretDown size={14} className={`text-black/45 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <>
          <button aria-hidden tabIndex={-1} onClick={close} className="fixed inset-0 cursor-default" />

          <div
            id="account-menu"
            className="absolute right-0 top-[calc(100%+10px)] w-[min(340px,calc(100vw-2rem))] origin-top-right rounded-[24px] bg-white p-2.5 shadow-[0_24px_64px_rgb(20_18_14/0.18)] ring-1 ring-black/[0.06] animate-in fade-in zoom-in-95 duration-150"
          >
            {/* The balance card, pocket-sized: same ink, the gold pooled in one corner. */}
            <div className="rounded-[18px] bg-[radial-gradient(130%_120%_at_100%_0%,#4A3B22_0%,#1B1812_46%,#0E0D0A_100%)] p-4 text-white">
              <div className="flex items-center justify-between gap-3">
                <p className="truncate text-[13px] text-white/65">{user?.display_name?.trim() || "Saku user"}</p>
                <span className="shrink-0 text-[11px] text-gilt/80">{NETWORK_CONFIG.name}</span>
              </div>
              <p className="mt-4 text-[30px] font-semibold leading-none tracking-tight tabular-nums">${balance}</p>
              <p className="mt-1.5 text-[12px] text-white/45">USDC balance</p>

              <div className="mt-4 flex items-center gap-1">
                <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-white/75">{short}</span>
                {walletAddress && (
                  <>
                    <button
                      onClick={copy}
                      aria-label="Copy address"
                      className="rounded-lg p-1.5 text-white/60 transition-colors hover:bg-white/10 hover:text-white"
                    >
                      {copied ? <Check size={15} /> : <Copy size={15} />}
                    </button>
                    <a
                      href={explorerAddressUrl(walletAddress)}
                      target="_blank"
                      rel="noreferrer"
                      aria-label="View on BscScan"
                      className="rounded-lg p-1.5 text-white/60 transition-colors hover:bg-white/10 hover:text-white"
                    >
                      <ArrowSquareOut size={15} />
                    </a>
                  </>
                )}
                <button
                  onClick={() => {
                    close()
                    shell?.openReceive()
                  }}
                  className="ml-1 flex shrink-0 items-center gap-1.5 rounded-full bg-white px-3 py-1.5 text-[12px] font-medium text-ink transition-colors hover:bg-white/90"
                >
                  <QrCode size={14} />
                  Receive
                </button>
              </div>
            </div>

            <div className="mt-1.5">
              <MenuLink href="/profile" icon={UserCircle} label="Profile" onSelect={close} />
              <MenuLink href="/profile/security" icon={ShieldCheck} label="Security & recovery" onSelect={close} />
              <MenuLink href="/notifications" icon={Bell} label="Notifications" onSelect={close} />
            </div>

            <div className="mt-1.5 border-t border-black/[0.06] pt-1.5">
              <button
                onClick={() => {
                  close()
                  logout()
                }}
                className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-[14px] font-medium text-negative transition-colors hover:bg-negative/[0.06]"
              >
                <SignOut size={18} />
                Sign out
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

function MenuLink({ href, icon: Glyph, label, onSelect }: { href: string; icon: Icon; label: string; onSelect: () => void }) {
  return (
    <Link
      href={href}
      onClick={onSelect}
      className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-[14px] font-medium text-ink/85 transition-colors hover:bg-black/[0.04]"
    >
      <Glyph size={18} className="text-black/50" />
      {label}
      <CaretRight size={14} className="ml-auto text-black/30" />
    </Link>
  )
}

/* --------------------------------------------------------------------------------------- rail */

function ToolRail({ pathname, shell }: { pathname: string; shell: WebShell }) {
  return (
    <nav
      aria-label="Tools"
      className="fixed inset-x-0 bottom-0 z-40 w-full max-w-full overflow-hidden border-t border-black/[0.06] bg-white pb-[env(safe-area-inset-bottom)] lg:sticky lg:inset-auto lg:top-16 lg:z-30 lg:h-[calc(100dvh-4rem)] lg:w-[88px] lg:shrink-0 lg:border-l lg:border-t-0 lg:pb-0"
    >
      <div className="grid grid-cols-8 px-1 py-1.5 lg:flex lg:h-full lg:flex-col lg:overflow-y-auto lg:px-2 lg:py-3">
        <button
          onClick={() => (shell.activeTool ? shell.closeTool() : shell.openTool("transfer"))}
          aria-label={shell.activeTool ? "Close panel" : "Open tools"}
          className="mx-auto mb-2 hidden h-9 w-9 shrink-0 items-center justify-center rounded-full text-black/40 transition-colors hover:bg-black/[0.05] hover:text-ink lg:flex"
        >
          {shell.activeTool ? <CaretDoubleRight size={16} /> : <CaretDoubleLeft size={16} />}
        </button>

        {TOOLS.map((tool) => {
          // On the tool's own page the page *is* the tool; a panel of it beside itself is noise.
          const here = isUnder(pathname, tool.href)
          return (
            <RailButton
              key={tool.id}
              icon={tool.icon}
              label={tool.label}
              active={here || shell.activeTool === tool.id}
              onClick={() => {
                if (here) return
                if (shell.activeTool === tool.id) shell.closeTool()
                else shell.openTool(tool.id)
              }}
            />
          )
        })}

        <RailButton icon={RECEIVE.icon} label={RECEIVE.label} active={false} onClick={shell.openReceive} />
      </div>
    </nav>
  )
}

function RailButton({ icon: Glyph, label, active, onClick }: { icon: Icon; label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      aria-current={active ? "true" : undefined}
      className="flex min-w-0 flex-col items-center gap-1 px-0.5 py-1 transition-colors lg:min-w-[68px] lg:shrink-0 lg:gap-1.5 lg:rounded-2xl lg:px-1 lg:pb-1.5 lg:pt-2 lg:hover:bg-black/[0.03]"
    >
      <span
        aria-hidden
        className={`flex h-8 w-8 items-center justify-center rounded-[11px] transition-[color,background-color,box-shadow] ${
          active
            ? "bg-ink text-gilt shadow-[inset_0_0_0_1px_rgb(221_186_124/0.24)]"
            : "text-[#8A5D16]"
        }`}
      >
        <Glyph size={20} weight={active ? "fill" : "regular"} />
      </span>
      <span className={`w-full truncate text-center text-[9px] font-medium leading-none lg:text-[11px] ${active ? "text-ink" : "text-black/55"}`}>{label}</span>
    </button>
  )
}

/* -------------------------------------------------------------------------------------- panel */

function ToolPanel({ tool, shell }: { tool: ToolId; shell: WebShell }) {
  const meta = TOOLS.find((t) => t.id === tool) ?? TOOLS[0]

  return (
    <aside
      aria-label={meta.label}
      className="animate-web-panel-in fixed inset-0 z-50 flex h-dvh min-w-0 flex-col bg-white pt-[env(safe-area-inset-top)] lg:sticky lg:inset-auto lg:top-16 lg:z-40 lg:h-[calc(100dvh-4rem)] lg:w-[420px] lg:shrink-0 lg:border-l lg:border-black/[0.06] lg:pt-0"
    >
      <div className="flex h-16 shrink-0 items-center gap-3 border-b border-black/[0.06] px-5">
        <IconTile icon={meta.icon} size="sm" />
        <h2 className="text-[17px] font-semibold tracking-tight">{meta.label}</h2>
        <button
          onClick={shell.closeTool}
          aria-label={`Close ${meta.label}`}
          className="ml-auto rounded-full p-2 text-black/45 transition-colors hover:bg-black/[0.05] hover:text-ink"
        >
          <X size={18} />
        </button>
      </div>

      <InPanelContext.Provider value={true}>
        {tool === "pay" ? (
          // The pay panes size themselves to the space they are given, like the sheet they come from.
          <div data-web-surface="" className="flex min-h-0 flex-1 flex-col pt-4">
            <PaySheet open variant="inline" onClose={shell.closeTool} />
          </div>
        ) : (
          <div data-web-surface="" className="min-h-0 flex-1 overflow-y-auto">
            {createElement(SCREENS[tool], { key: tool })}
          </div>
        )}
      </InPanelContext.Provider>
    </aside>
  )
}
