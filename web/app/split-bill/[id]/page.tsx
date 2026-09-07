"use client"

/**
 * One split bill: every share, who has paid, and the button to pay yours.
 *
 * Paying sends USDC straight to the person who created the bill. Saku never holds it and takes
 * no fee — this is the same wallet-to-wallet transfer as anywhere else, just recorded against a
 * share so both sides can see the bill close.
 */

import { use, useEffect } from "react"
import { useRouter } from "next/navigation"
import { ArrowLeft, Check, Clock, Loader2, Receipt } from "lucide-react"
import { useAuth } from "@/hooks/useAuth"
import { useMpcWallet } from "@/hooks/useMpcWallet"
import { useTokenBalances } from "@/hooks/useTokenBalances"
import { useBillDetails } from "@/hooks/useSplitBill"
import { CONTRACTS } from "@/lib/config"

export default function BillDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const router = useRouter()
  const { user, wallet, isLoading, isAuthenticated } = useAuth()
  const { address } = useMpcWallet()
  const { bill, isLoading: loadingBill, paying, error, payShare } = useBillDetails(id)

  const walletAddress = address ?? wallet?.address ?? null
  const { balances, refresh } = useTokenBalances(walletAddress)
  const usdc = balances.find((t) => t.address.toLowerCase() === CONTRACTS.USDC.toLowerCase())

  useEffect(() => {
    if (!isLoading && !isAuthenticated) router.replace("/get-started")
  }, [isLoading, isAuthenticated, router])

  useEffect(() => {
    if (bill?.myShare?.status === "paid") void refresh()
  }, [bill?.myShare?.status, refresh])

  if (isLoading || (loadingBill && !bill)) {
    return (
      <div className="min-h-dvh bg-white flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-black/20" />
      </div>
    )
  }

  if (!user) return null

  if (!bill) {
    return (
      <div className="min-h-dvh bg-white flex items-center justify-center p-6 font-sans">
        <div className="text-center space-y-4 max-w-sm">
          <Receipt className="w-10 h-10 mx-auto text-black/15" />
          <p className="text-sm font-semibold text-black/60">{error ?? "Bill not found"}</p>
          <button
            onClick={() => router.push("/split-bill")}
            className="w-full py-4 bg-black text-white rounded-2xl font-bold"
          >
            Back
          </button>
        </div>
      </div>
    )
  }

  const owesNow = bill.myShare && bill.myShare.status === "pending"
  const canPay =
    owesNow && (!usdc || Number(bill.myShare!.amount) <= Number(usdc.formatted))

  return (
    <div className="min-h-dvh bg-white font-sans">
      <div className="max-w-lg mx-auto px-5 py-6 space-y-6">
        <div className="flex items-center gap-3">
          <button
            onClick={() => router.push("/split-bill")}
            aria-label="Back"
            className="p-2 -ml-2 rounded-full hover:bg-black/5 transition-colors"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <h1 className="text-xl font-black tracking-tight truncate">{bill.title}</h1>
        </div>

        <div className="rounded-3xl border border-black/8 bg-[#FAFAFA] px-5 py-6 text-center space-y-1">
          <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-black/35">Total</p>
          <p className="text-4xl font-black tabular-nums">{bill.totalAmount}</p>
          <p className="text-sm font-bold text-black/35">USDC</p>
          <p className="text-xs text-black/40 pt-2">
            {bill.paidCount} of {bill.shares.length} paid
            {bill.status === "settled" && " · settled"}
          </p>
        </div>

        <div className="space-y-2">
          <p className="text-[10px] font-bold uppercase tracking-widest text-black/35 px-1">
            Shares
          </p>
          {bill.shares.map((s) => (
            <div
              key={s.id}
              className={`flex items-center gap-3 p-3.5 rounded-2xl border ${
                s.isMe ? "border-black/20 bg-black/[0.02]" : "border-black/6"
              }`}
            >
              <div
                className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${
                  s.status === "paid"
                    ? "bg-emerald-100 text-emerald-600"
                    : "bg-black/[0.05] text-black/35"
                }`}
              >
                {s.status === "paid" ? <Check className="w-4 h-4" /> : <Clock className="w-4 h-4" />}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-bold truncate">
                  {s.label}
                  {s.isMe && " (you)"}
                </p>
                <p className="text-[11px] text-black/40 capitalize">{s.status}</p>
              </div>
              <p className="text-sm font-black tabular-nums shrink-0">{s.amount} USDC</p>
            </div>
          ))}
        </div>

        {error && <p className="text-sm font-medium text-red-600">{error}</p>}

        {owesNow ? (
          <>
            <div className="rounded-2xl border border-black/8 bg-[#FAFAFA] px-4 py-3 flex items-baseline justify-between">
              <span className="text-sm font-medium text-black/45">Your balance</span>
              <span className="text-lg font-black tabular-nums">{usdc?.formatted ?? "0"} USDC</span>
            </div>

            <button
              onClick={payShare}
              disabled={!canPay || paying}
              className="w-full py-4 bg-black text-white rounded-2xl font-bold shadow-lg disabled:opacity-25 active:scale-[0.98] transition-all flex items-center justify-center gap-2"
            >
              {paying && <Loader2 className="w-4 h-4 animate-spin" />}
              {paying ? "Paying…" : `Pay ${bill.myShare!.amount} USDC`}
            </button>
            <p className="text-[11px] text-center text-black/35">
              Sent straight to whoever created this bill. No platform fee.
            </p>
          </>
        ) : bill.myShare ? (
          <p className="text-sm text-center text-black/45">You&apos;ve paid your share.</p>
        ) : (
          <p className="text-sm text-center text-black/45">You created this bill.</p>
        )}
      </div>
    </div>
  )
}
