"use client"

/**
 * Recent activity: a row per transaction, direction shown as sign and colour. Every row here
 * corresponds to a real BSC Testnet transaction.
 *
 * The row reads left to right as what, who, how much, how long ago. The time used to sit in the
 * subtitle on the left while the amount sat on the right, so the two figures anyone actually
 * scans a list like this for were on opposite sides of the row. They share a column now.
 *
 * Tapping a row hands off to History with that receipt already open (`/transactions?tx=…`)
 * rather than opening a modal over the home screen. Closing the receipt then leaves the user in
 * the list the transaction belongs to, with the rest of their history right there — closing it
 * on top of Home used to drop them back to a screen showing five rows and no way onward.
 */

import { useRouter } from "next/navigation"
import { ArrowDownLeft, ArrowUpRight, ChevronRight, Loader2, Receipt } from "lucide-react"
import { formatUnits } from "ethers"
import { useTransactions } from "@/hooks/useTransactions"
import { describeTransaction } from "@/lib/receipt-content"
import SectionHeading from "@/components/home/section-heading"

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
    <section className="animate-in fade-in slide-in-from-bottom-4 duration-500 font-sans">
      <SectionHeading title="Recent Activity" href="/transactions" linkLabel="View all" />

      <div className="rounded-3xl border border-black/[0.06] bg-white/30 backdrop-blur-xl p-[clamp(7px,1.95vw,10px)]">
        {isLoading && transactions.length === 0 ? (
          <div className="py-10 flex justify-center">
            <Loader2 className="w-5 h-5 animate-spin text-black/20" />
          </div>
        ) : transactions.length === 0 ? (
          <div className="py-10 text-center space-y-2">
            <Receipt className="w-8 h-8 mx-auto text-black/15" />
            <p className="text-xs font-medium text-black/40">Nothing here yet</p>
            <p className="text-[11px] text-black/30">Your transfers and packets will show up here.</p>
          </div>
        ) : (
          <div className="divide-y divide-black/[0.04]">
            {transactions.map((tx) => {
              const incoming = tx.direction === "in"
              const { label } = describeTransaction(tx)
              return (
                <button
                  key={tx.txHash}
                  onClick={() => router.push(`/transactions?tx=${tx.txHash}`)}
                  className="group w-full flex items-center gap-[clamp(8px,2.34vw,12px)] p-[clamp(8px,2.34vw,12px)] rounded-2xl hover:bg-white/60 transition-colors text-left"
                >
                  <div
                    className={`w-[clamp(30px,7.81vw,40px)] h-[clamp(30px,7.81vw,40px)] rounded-full flex items-center justify-center shrink-0 ${
                      incoming ? "bg-emerald-100 text-emerald-600" : "bg-orange-100 text-[#F0A353]"
                    }`}
                  >
                    {incoming ? <ArrowDownLeft className="w-[clamp(15px,3.91vw,20px)] h-[clamp(15px,3.91vw,20px)]" /> : <ArrowUpRight className="w-[clamp(15px,3.91vw,20px)] h-[clamp(15px,3.91vw,20px)]" />}
                  </div>

                  <div className="min-w-0 flex-1">
                    {/* The kind of thing it was, then who it was with. The name used to lead,
                        which read well for a transfer and badly for everything else: "Sarah"
                        alone never said whether it was a QR payment or a packet. */}
                    <p className="text-[length:clamp(11px,2.73vw,14px)] font-bold text-slate-900 truncate">{label}</p>
                    <p className="text-[length:clamp(8px,2.15vw,11px)] text-black/40 truncate">
                      {tx.counterpartyName ?? (incoming ? "Received" : "Sent")}
                    </p>
                  </div>

                  {/* Amount over time, right-aligned. The time moved out of the subtitle so the
                      two numbers a person scans for — how much, how long ago — sit in one
                      column instead of on opposite sides of the row. */}
                  <div className="text-right shrink-0">
                    <p className={`text-[length:clamp(11px,2.73vw,14px)] font-bold tabular-nums ${incoming ? "text-emerald-600" : "text-slate-900"}`}>
                      {incoming ? "+" : "−"}{formatAmount(tx.amount)} USDC
                    </p>
                    <p className="text-[length:clamp(8px,2.15vw,11px)] text-black/35 tabular-nums">{formatWhen(tx.occurredAt)}</p>
                  </div>

                  <ChevronRight className="w-[clamp(12px,3.13vw,16px)] h-[clamp(12px,3.13vw,16px)] shrink-0 text-black/20 transition-transform group-hover:translate-x-0.5" />
                </button>
              )
            })}
          </div>
        )}
      </div>
    </section>
  )
}
