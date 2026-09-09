"use client"

/**
 * Bills waiting on you, on Home.
 *
 * A split bill arrives the same way a private packet does — addressed to your number, with no
 * link to click — and until this existed the only way to find one was to open Split Bill and
 * scroll. A bill someone is waiting to be paid back for should not need looking for.
 *
 * Renders nothing when nothing is owed, so a settled-up Home stays quiet. Mirrors
 * `WaitingPackets` deliberately: two things arrive unbidden and addressed to you, and they
 * should look like the same kind of thing.
 */

import { useRouter } from "next/navigation"
import { motion } from "framer-motion"
import { ArrowRight, Receipt } from "lucide-react"
import { useSplitBills } from "@/hooks/useSplitBill"

export default function BillsToPay() {
  const router = useRouter()
  const { owed } = useSplitBills()

  const unpaid = owed.filter((share) => share.status !== "paid")
  if (unpaid.length === 0) return null

  const total = unpaid.reduce((sum, share) => sum + Number(share.amount), 0)

  return (
    <div className="animate-in fade-in slide-in-from-bottom-4 duration-500 font-sans space-y-3">
      <div className="flex items-end justify-between px-1">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-widest text-purple-600">
            You owe
          </p>
          <h2 className="text-lg font-black tracking-tight">
            {unpaid.length} {unpaid.length === 1 ? "bill" : "bills"} to settle
          </h2>
        </div>
        <p className="text-sm font-black tabular-nums text-black/55 pb-1">{total.toFixed(2)} USDC</p>
      </div>

      <div className="space-y-2">
        {unpaid.slice(0, 3).map((share, index) => (
          <motion.button
            key={share.shareId}
            onClick={() => router.push(`/split-bill/${share.billId}`)}
            initial={{ opacity: 0, x: -12 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: index * 0.06 }}
            className="group w-full rounded-3xl bg-white/60 backdrop-blur-xl border border-white/70 p-3.5 shadow-[0_10px_30px_rgba(147,51,234,0.08)] text-left"
          >
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-2xl bg-purple-100 text-purple-600 flex items-center justify-center shrink-0 transition-transform group-hover:rotate-6">
                <Receipt className="w-5 h-5" />
              </div>

              <div className="min-w-0 flex-1">
                <p className="text-sm font-black tracking-tight truncate">{share.title}</p>
                <p className="text-[11px] text-black/40 truncate">
                  {share.fromName ? `From ${share.fromName}` : "Split bill"} ·{" "}
                  {Number(share.amount).toFixed(2)} USDC
                </p>
              </div>

              <span className="shrink-0 flex items-center gap-1 px-3.5 py-2 rounded-xl bg-black text-white text-[11px] font-bold group-hover:bg-purple-600 transition-colors">
                Pay
                <ArrowRight className="w-3 h-3 group-hover:translate-x-0.5 transition-transform" />
              </span>
            </div>
          </motion.button>
        ))}

        {unpaid.length > 3 && (
          <button
            onClick={() => router.push("/split-bill?tab=owed")}
            className="w-full py-2.5 text-[11px] font-bold text-black/45 hover:text-black transition-colors"
          >
            See all {unpaid.length}
          </button>
        )}
      </div>
    </div>
  )
}
