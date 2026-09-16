"use client"

/**
 * The web wallet's frame, as a screen sees it from the inside.
 *
 * Saku's screens were written once, for the app, and the web wallet renders those same screens
 * rather than keeping a second copy of every flow. A screen only needs to know two things about
 * where it is: whether it is inside the tool panel, and what "leave" and "go to" mean there.
 *
 *  - In the app, leaving is Home and going somewhere is a navigation — exactly what every screen
 *    did before this file existed. `useScreenNav` is `router.push` there, nothing more.
 *  - In the web wallet, a tool's route opens that tool in the panel instead of navigating the
 *    page away, and leaving a screen that is *in* the panel closes the panel.
 *
 * `WebShellContext` is null everywhere outside the web wallet, which is how the rest of the app
 * tells the two apart without asking about screen sizes.
 */

import { createContext, useContext } from "react"
import { useRouter } from "next/navigation"
import { APP_HOME, WEB_HOME } from "@/components/web/app-mode"
import type { Icon } from "@phosphor-icons/react"
import { Bank, ChartLineUp, CreditCard, Gift, PaperPlaneTilt, QrCode, Receipt, Scan } from "@phosphor-icons/react"

export type ToolId = "transfer" | "pay" | "topup" | "withdraw" | "packet" | "split-bill" | "earn"

export interface Tool {
  id: ToolId
  label: string
  /** One line, plain verb first — the same lines the app's Main Services tiles use. */
  description: string
  /** The screen's own route, which is also where the tool lives when opened as a page. */
  href: string
  icon: Icon
}

// Named as the app names them, so an action is called the same thing in both places.
export const TOOLS: Tool[] = [
  { id: "transfer", label: "Transfer", description: "To a phone number", href: "/transfer", icon: PaperPlaneTilt },
  { id: "pay", label: "Pay", description: "Scan or show a code", href: "/pay", icon: Scan },
  { id: "topup", label: "Top up", description: "Add money", href: "/topup", icon: CreditCard },
  { id: "withdraw", label: "Withdraw", description: "To an e-wallet or bank", href: "/offramp", icon: Bank },
  { id: "packet", label: "Packet", description: "Send a gift", href: "/packet", icon: Gift },
  { id: "split-bill", label: "Split bill", description: "Share a cost", href: "/split-bill", icon: Receipt },
  { id: "earn", label: "Earn", description: "Grow your balance", href: "/staking", icon: ChartLineUp },
]

/** Not a tool with a screen: it opens the address dialog. Listed beside the tools all the same. */
export const RECEIVE = { label: "Receive", description: "Show your address", icon: QrCode } as const

export interface WebShell {
  activeTool: ToolId | null
  /**
   * Goes up by one each time the tool panel closes. The page under the panel stays mounted while a
   * transfer or a top up happens beside it, so nothing re-reads a balance the way navigating back
   * to Home does in the app. Anything showing money watches this instead.
   */
  version: number
  /** `at` pins the panel to a route other than the current one — for opening it across a redirect. */
  openTool: (id: ToolId, at?: string) => void
  closeTool: () => void
  openReceive: () => void
}

export const WebShellContext = createContext<WebShell | null>(null)

/** True for anything rendered inside the tool panel. */
export const InPanelContext = createContext(false)

export function useWebShell() {
  return useContext(WebShellContext)
}

export function useInPanel() {
  return useContext(InPanelContext)
}

export function useScreenNav() {
  const router = useRouter()
  const shell = useContext(WebShellContext)
  const inPanel = useContext(InPanelContext)

  return {
    /** Done with this screen. */
    exit: () => {
      if (shell && inPanel) shell.closeTool()
      else router.push(shell ? WEB_HOME : APP_HOME)
    },
    /** Another screen. In the web wallet, a plain tool route opens that tool in the panel. */
    go: (href: string) => {
      const tool = TOOLS.find((t) => t.href === href)
      if (shell && tool) shell.openTool(tool.id)
      else router.push(href)
    },
  }
}
