"use client"

/**
 * Recent activity, in the v1 shape: a card, a row per transaction, direction shown as sign and
 * colour. Every row here corresponds to a real BSC Testnet transaction.
 *
 * Tapping a row hands off to History with that receipt already open (`/transactions?tx=…`)
 * rather than opening a modal over the home screen. Closing the receipt then leaves the user in
 * the list the transaction belongs to, with the rest of their history right there — closing it
 * on top of Home used to drop them back to a screen showing five rows and no way onward.
 */

import { useRouter } from "next/navigation"
import { ArrowDownLeft, ArrowUpRight, Loader2, Receipt } from "lucide-react"
import { formatUnits } from "ethers"
import { useTransactions, type SakuTransaction } from "@/hooks/useTransactions"
import { describeTransaction } from "@/lib/receipt-content"

const USDC_DECIMALS = 6

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

function formatWhen(iso: string) {
  const date = new Date(iso)
  return date.toLocaleDateString("en-US", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })
}

export default function RecentTransactions() {
  const router = useRouter()
  const { transactions, isLoading } = useTransactions(5)

  return (
    <div className="animate-in fade-in slide-in-from-bottom-4 duration-500 font-sans">
      <div className="bg-white/40 backdrop-blur-xl border border-white/60 rounded-3xl p-6 shadow-[0_15px_35px_rgba(240,163,83,0.08)]">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-sm font-semibold text-black/40">Recent Activity</h2>
          <div className="h-px flex-1 bg-gradient-to-r from-transparent via-black/5 to-transparent ml-4" />
        </div>

        {isLoading && transactions.length === 0 ? (
          <div className="py-8 flex justify-center">
            <Loader2 className="w-5 h-5 animate-spin text-black/20" />
          </div>
        ) : transactions.length === 0 ? (
          <div className="py-8 text-center space-y-2">
            <Receipt className="w-8 h-8 mx-auto text-black/15" />
            <p className="text-xs font-medium text-black/40">No transactions yet</p>
          </div>
        ) : (
          <div className="space-y-2">
            {transactions.map((tx) => {
              const incoming = tx.direction === "in"
              const { label } = describeTransaction(tx)
              return (
                <button
                  key={tx.txHash}
                  onClick={() => router.push(`/transactions?tx=${tx.txHash}`)}
                  className="group w-full flex items-center gap-3 p-3 rounded-2xl hover:bg-white/60 transition-colors text-left"
                >
                  <div
                    className={`w-10 h-10 rounded-2xl flex items-center justify-center shrink-0 ${
                      incoming ? "bg-emerald-100 text-emerald-600" : "bg-orange-100 text-[#F0A353]"
                    }`}
                  >
                    {incoming ? <ArrowDownLeft className="w-5 h-5" /> : <ArrowUpRight className="w-5 h-5" />}
                  </div>

                  <div className="min-w-0 flex-1">
                    {/* The name is what a person recognises; the type moves down a line rather
                        than away, since "Sarah" alone doesn't say whether it was a QR pay. */}
                    <p className="text-sm font-bold text-black/80 truncate">
                      {tx.counterpartyName ?? label}
                    </p>
                    <p className="text-[11px] text-black/40 truncate">
                      {tx.counterpartyName ? `${label} · ` : ""}
                      {formatWhen(tx.occurredAt)}
                    </p>
                  </div>

                  <div className="text-right shrink-0">
                    <p className={`text-sm font-black tabular-nums ${incoming ? "text-emerald-600" : "text-black/80"}`}>
                      {incoming ? "+" : "−"}{formatAmount(tx.amount)}
                    </p>
                    <p className="text-[10px] font-semibold text-black/30 flex items-center justify-end gap-1">
                      USDC <Receipt className="w-2.5 h-2.5 opacity-0 group-hover:opacity-100 transition-opacity" />
                    </p>
                  </div>
                </button>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
