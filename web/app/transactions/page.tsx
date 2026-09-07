"use client"

/**
 * Full transaction history.
 *
 * Reads the `transactions` cache, which is written only from verified receipts — so every row
 * here corresponds to a real BSC Testnet transaction and links out to it. The chain stays the
 * source of truth; this is the fast path for rendering it.
 */

import { useEffect } from "react"
import { useRouter } from "next/navigation"
import { ArrowDownLeft, ArrowLeft, ArrowUpRight, ExternalLink, Loader2, Receipt } from "lucide-react"
import { formatUnits } from "ethers"
import { useAuth } from "@/hooks/useAuth"
import { useTransactions, type SakuTransaction } from "@/hooks/useTransactions"
import { explorerTxUrl } from "@/lib/config"
import BottomNavigation from "@/components/home/bottom-navigation"

const USDC_DECIMALS = 6

const TYPE_LABEL: Record<SakuTransaction["type"], string> = {
  transfer: "Transfer",
  topup: "Top Up",
  withdraw: "Withdraw",
  qr_payment: "QR Pay",
  offramp_lock: "Sent to e-wallet",
  offramp_settle: "Off-ramp settled",
  offramp_refund: "Off-ramp refunded",
}

function formatAmount(amount: string | null) {
  if (!amount) return "0.00"
  try {
    return Number(formatUnits(amount, USDC_DECIMALS)).toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
  } catch {
    return "0.00"
  }
}

/** Group by day so a long list reads as a timeline rather than a wall of rows. */
function dayKey(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", { day: "numeric", month: "long", year: "numeric" })
}

export default function TransactionsPage() {
  const router = useRouter()
  const { user, isLoading, isAuthenticated } = useAuth()
  const { transactions, isLoading: loadingTx } = useTransactions(50)

  useEffect(() => {
    if (!isLoading && !isAuthenticated) router.replace("/get-started")
  }, [isLoading, isAuthenticated, router])

  if (isLoading) {
    return (
      <div className="min-h-dvh bg-white flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-black/20" />
      </div>
    )
  }

  if (!user) return null

  const groups = transactions.reduce<Record<string, SakuTransaction[]>>((acc, tx) => {
    const key = dayKey(tx.occurredAt)
    acc[key] = acc[key] ?? []
    acc[key].push(tx)
    return acc
  }, {})

  return (
    <div className="min-h-dvh bg-white font-sans max-w-lg mx-auto">
      <div className="px-5 py-6 space-y-6">
        <div className="flex items-center gap-3">
          <button
            onClick={() => router.push("/home")}
            aria-label="Back"
            className="p-2 -ml-2 rounded-full hover:bg-black/5 transition-colors"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <h1 className="text-xl font-black tracking-tight">History</h1>
        </div>

        {loadingTx && transactions.length === 0 ? (
          <div className="py-16 flex justify-center">
            <Loader2 className="w-5 h-5 animate-spin text-black/20" />
          </div>
        ) : transactions.length === 0 ? (
          <div className="py-16 text-center space-y-2">
            <Receipt className="w-10 h-10 mx-auto text-black/12" />
            <p className="text-sm font-medium text-black/40">No transactions yet</p>
            <p className="text-xs text-black/30">Top up or send something to get started.</p>
          </div>
        ) : (
          <div className="space-y-6">
            {Object.entries(groups).map(([day, rows]) => (
              <div key={day} className="space-y-1">
                <p className="text-[10px] font-bold uppercase tracking-widest text-black/35 px-1 pb-1">
                  {day}
                </p>

                {rows.map((tx) => {
                  const incoming = tx.direction === "in"
                  return (
                    <a
                      key={tx.txHash}
                      href={explorerTxUrl(tx.txHash)}
                      target="_blank"
                      rel="noreferrer"
                      className="group flex items-center gap-3 p-3 rounded-2xl hover:bg-black/[0.02] transition-colors"
                    >
                      <div
                        className={`w-10 h-10 rounded-2xl flex items-center justify-center shrink-0 ${
                          incoming ? "bg-emerald-100 text-emerald-600" : "bg-orange-100 text-[#F0A353]"
                        }`}
                      >
                        {incoming ? (
                          <ArrowDownLeft className="w-5 h-5" />
                        ) : (
                          <ArrowUpRight className="w-5 h-5" />
                        )}
                      </div>

                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-bold text-black/80 truncate">{TYPE_LABEL[tx.type]}</p>
                        <p className="text-[11px] text-black/40">
                          {new Date(tx.occurredAt).toLocaleTimeString("en-US", {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                          {tx.status !== "confirmed" && ` · ${tx.status}`}
                        </p>
                      </div>

                      <div className="text-right shrink-0">
                        <p
                          className={`text-sm font-black tabular-nums ${
                            incoming ? "text-emerald-600" : "text-black/80"
                          }`}
                        >
                          {incoming ? "+" : "−"}{formatAmount(tx.amount)}
                        </p>
                        <p className="text-[10px] font-semibold text-black/30 flex items-center justify-end gap-1">
                          USDC
                          <ExternalLink className="w-2.5 h-2.5 opacity-0 group-hover:opacity-100 transition-opacity" />
                        </p>
                      </div>
                    </a>
                  )
                })}
              </div>
            ))}
          </div>
        )}
      </div>

      <BottomNavigation />
    </div>
  )
}
