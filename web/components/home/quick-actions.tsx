"use client"

/**
 * The v1 "Main Services" grid, rebuilt on v2 state.
 *
 * Same layout and the same six actions. Two things changed underneath: the wallet address comes
 * from the session (`/api/me`) or the live MPC provider rather than a `profiles` row, and each
 * action carries a `ready` flag. Features are being rebuilt one at a time, and an icon that
 * navigates to a route that does not exist yet is worse than one that says it is coming.
 */

import { useRouter } from "next/navigation"
import { ArrowDownLeft, ArrowUpRight, Gift, Send, TrendingUp, Users2 } from "lucide-react"
import { useAuth } from "@/hooks/useAuth"
import { useMpcWallet } from "@/hooks/useMpcWallet"

interface QuickAction {
  id: string
  label: string
  icon: React.ElementType
  color: string
  href: string
  ready: boolean
}

// QR Pay is deliberately absent: it is the raised button in the middle of the nav bar, and
// listing it here too would be the same action twice on one screen.
const quickActions: QuickAction[] = [
  { id: "topup", label: "Top Up", icon: ArrowDownLeft, color: "bg-orange-100 text-[#F0A353]", href: "/topup", ready: true },
  { id: "transfer", label: "Transfer", icon: Send, color: "bg-blue-100 text-blue-600", href: "/transfer", ready: true },
  { id: "packet", label: "Packet", icon: Gift, color: "bg-red-100 text-red-600", href: "/packet", ready: true },
  { id: "split-bill", label: "Split Bill", icon: Users2, color: "bg-purple-100 text-purple-600", href: "/split-bill", ready: true },
  { id: "withdraw", label: "Withdraw", icon: ArrowUpRight, color: "bg-slate-200 text-slate-600", href: "/offramp", ready: true },
  { id: "staking", label: "Earn", icon: TrendingUp, color: "bg-teal-100 text-teal-600", href: "/staking", ready: true },
]

export default function QuickActions() {
  const router = useRouter()
  const { wallet, isLoading } = useAuth()
  const { address } = useMpcWallet()

  const walletAddress = address ?? wallet?.address ?? null

  return (
    <div className="animate-in fade-in slide-in-from-bottom-4 duration-500 font-sans">
      <div className="bg-white/40 backdrop-blur-xl border border-white/60 rounded-3xl p-6 shadow-[0_15px_35px_rgba(240,163,83,0.08)] relative overflow-hidden">
        <div className="absolute top-0 right-0 w-24 h-24 bg-primary/10 rounded-full blur-2xl" />

        <div className="flex items-center justify-between mb-6">
          <h2 className="text-sm font-semibold text-black/40">Main Services</h2>
          <div className="h-px flex-1 bg-gradient-to-r from-transparent via-black/5 to-transparent ml-4" />
        </div>

        <div className="grid grid-cols-3 gap-y-7 gap-x-3">
          {quickActions.map((action) => {
            const Icon = action.icon
            const disabled = !walletAddress || isLoading || !action.ready

            return (
              <button
                key={action.id}
                onClick={() => router.push(action.href)}
                disabled={disabled}
                title={!action.ready ? "Coming soon" : undefined}
                className="flex flex-col items-center group transition-all active:scale-95 disabled:opacity-40 disabled:active:scale-100"
              >
                <div
                  className={`w-14 h-14 rounded-[1.4rem] ${action.color} flex items-center justify-center transition-all duration-300 border-2 border-white shadow-sm group-enabled:group-hover:shadow-md group-enabled:group-hover:-translate-y-1`}
                >
                  <Icon className="w-6 h-6" strokeWidth={2.5} />
                </div>
                <span className="text-[10px] font-black text-black/60 mt-3 text-center transition-colors group-hover:text-black">
                  {action.label}
                </span>
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
