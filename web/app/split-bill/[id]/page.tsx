"use client"

/**
 * One split bill: the receipt behind it, every share, who has paid, and how to settle yours.
 *
 * Two ways to settle, presented as a choice rather than one button with an escape hatch. Paying
 * through Saku sends USDC straight to whoever created the bill — no middle account, no fee.
 * Paying another way (cash, a bank app) is recorded honestly as what it is: your word, with a
 * note, marked as settled outside Saku so the creator can see the difference. Money that never
 * moved through here is never shown as if it did.
 */

import { use, useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { ArrowLeft, Banknote, Check, ChevronDown, Clock, Loader2, Receipt, Wallet } from "lucide-react"
import { useAuth } from "@/hooks/useAuth"
import { formatUsdc, transferFee } from "@/lib/fees"
import { useMpcWallet } from "@/hooks/useMpcWallet"
import { useTokenBalances } from "@/hooks/useTokenBalances"
import { useBillDetails } from "@/hooks/useSplitBill"
import { formatMoney, itemTotal } from "@/lib/split-bill-math"
import { CONTRACTS } from "@/lib/config"

export default function BillDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const router = useRouter()
  const { user, wallet, isLoading, isAuthenticated } = useAuth()
  const { address } = useMpcWallet()
  const { bill, isLoading: loadingBill, paying, error, payShare, settleExternally } = useBillDetails(id)

  const [expanded, setExpanded] = useState<string | null>(null)
  const [payMethod, setPayMethod] = useState<"saku" | "external">("saku")
  const [note, setNote] = useState("")

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

  const breakdown = bill.breakdown
  const currency = breakdown?.currency ?? null
  const labelById = new Map((breakdown?.participants ?? []).map((p) => [p.id, p.label]))

  const owesNow = bill.myShare && bill.myShare.status === "pending"
  const canPayWithSaku = owesNow && (!usdc || Number(bill.myShare!.amount) <= Number(usdc.formatted))

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
          <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-black/35">
            {bill.isCreator ? "Owed to you" : "Total"}
          </p>
          <p className="text-4xl font-black tabular-nums">{bill.totalAmount}</p>
          <p className="text-sm font-bold text-black/35">USDC</p>
          <p className="text-xs text-black/40 pt-2">
            {bill.paidCount} of {bill.shares.length} paid
            {bill.status === "settled" && " · settled"}
          </p>
        </div>

        {/* The receipt this came from. Only bills created by item have one. */}
        {breakdown && breakdown.items.length > 0 && (
          <div className="space-y-2">
            <p className="text-[10px] font-bold uppercase tracking-widest text-black/35 px-1">
              Receipt
            </p>
            <div className="rounded-2xl border border-black/6 p-4 space-y-2">
              {breakdown.items.map((item) => (
                <div key={item.id} className="flex items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold truncate">
                      {item.qty > 1 && <span className="text-black/40">{item.qty}× </span>}
                      {item.name || "Item"}
                    </p>
                    <p className="text-[10px] text-black/40 truncate">
                      {item.assignedTo.length > 0
                        ? item.assignedTo.map((pid) => labelById.get(pid) ?? "Someone").join(", ")
                        : "Split across everyone"}
                    </p>
                  </div>
                  <p className="text-sm font-bold tabular-nums shrink-0">
                    {formatMoney(itemTotal(item), currency)}
                  </p>
                </div>
              ))}

              <div className="h-px bg-black/[0.07] my-1" />

              {(
                [
                  ["Tax / PPN", breakdown.charges.tax],
                  ["Service", breakdown.charges.service],
                  ["Discount", -breakdown.charges.discount],
                ] as const
              )
                .filter(([, value]) => value !== 0)
                .map(([label, value]) => (
                  <div key={label} className="flex items-baseline justify-between text-xs text-black/45">
                    <span>{label}</span>
                    <span className="tabular-nums font-semibold">
                      {value < 0 ? "−" : ""}
                      {formatMoney(Math.abs(value), currency)}
                    </span>
                  </div>
                ))}
            </div>
          </div>
        )}

        <div className="space-y-2">
          <p className="text-[10px] font-bold uppercase tracking-widest text-black/35 px-1">Shares</p>
          {bill.shares.map((s) => {
            const isOpen = expanded === s.id
            const detail = s.breakdown

            return (
              <div
                key={s.id}
                className={`rounded-2xl border ${s.isMe ? "border-black/20 bg-black/[0.02]" : "border-black/6"}`}
              >
                <button
                  onClick={() => setExpanded(isOpen ? null : s.id)}
                  disabled={!detail}
                  className="w-full flex items-center gap-3 p-3.5 text-left disabled:cursor-default"
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
                    <p className="text-[11px] text-black/40">
                      {s.status === "paid" && s.paymentMethod === "external"
                        ? `Paid outside Saku${s.paymentNote ? ` · ${s.paymentNote}` : ""}`
                        : s.status === "paid"
                          ? "Paid with Saku"
                          : "Pending"}
                    </p>
                  </div>
                  <p className="text-sm font-black tabular-nums shrink-0">{s.amount} USDC</p>
                  {detail && (
                    <ChevronDown
                      className={`w-4 h-4 shrink-0 text-black/25 transition-transform ${isOpen ? "rotate-180" : ""}`}
                    />
                  )}
                </button>

                {isOpen && detail && (
                  <div className="px-3.5 pb-3.5 -mt-1 space-y-1">
                    <div className="h-px bg-black/[0.07] mb-2" />
                    {detail.items.map((item, i) => (
                      <div key={i} className="flex items-baseline justify-between text-xs">
                        <span className="text-black/55 truncate pr-3">{item.name || "Item"}</span>
                        <span className="tabular-nums font-semibold shrink-0">
                          {formatMoney(item.amount, currency)}
                        </span>
                      </div>
                    ))}
                    {(
                      [
                        ["Tax / PPN", detail.tax],
                        ["Service", detail.service],
                        ["Discount", -detail.discount],
                      ] as const
                    )
                      .filter(([, value]) => value !== 0)
                      .map(([label, value]) => (
                        <div
                          key={label}
                          className="flex items-baseline justify-between text-xs text-black/40"
                        >
                          <span>{label}</span>
                          <span className="tabular-nums font-semibold">
                            {value < 0 ? "−" : ""}
                            {formatMoney(Math.abs(value), currency)}
                          </span>
                        </div>
                      ))}
                    <div className="flex items-baseline justify-between text-xs font-bold pt-1">
                      <span>Their total</span>
                      <span className="tabular-nums">{formatMoney(detail.total, currency)}</span>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>

        {error && <p className="text-sm font-medium text-red-600">{error}</p>}

        {owesNow ? (
          <div className="space-y-3">
            <p className="text-[10px] font-bold uppercase tracking-widest text-black/35 px-1">
              How are you paying?
            </p>

            <div className="grid grid-cols-2 gap-2">
              {(
                [
                  ["saku", "With Saku", Wallet, "USDC, straight to them"],
                  ["external", "Another way", Banknote, "Cash, bank app — just record it"],
                ] as const
              ).map(([value, label, Icon, hint]) => (
                <button
                  key={value}
                  onClick={() => setPayMethod(value)}
                  className={`p-3.5 rounded-2xl border-2 text-left transition-all ${
                    payMethod === value ? "border-black bg-black/[0.02]" : "border-black/[0.08] hover:border-black/25"
                  }`}
                >
                  <Icon className={`w-4 h-4 mb-1.5 ${payMethod === value ? "" : "text-black/35"}`} />
                  <p className="text-sm font-bold leading-tight">{label}</p>
                  <p className="text-[10px] text-black/40 leading-tight mt-0.5">{hint}</p>
                </button>
              ))}
            </div>

            {payMethod === "saku" ? (
              <>

              {/* Before signing, not only on the receipt. */}
              <div className="rounded-2xl border border-black/8 bg-[#FAFAFA] px-4 py-3 space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-black/45">{"Your share"}</span>
                  <span className="font-bold tabular-nums">{formatUsdc(Number(bill.myShare!.amount || 0))} USDC</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-black/45">
                    Platform fee ({(transferFee(1).bps / 100).toFixed(2)}%)
                  </span>
                  <span className="font-bold tabular-nums">
                    +{formatUsdc(transferFee(Number(bill.myShare!.amount || 0)).feeUsdc)} USDC
                  </span>
                </div>
                <div className="flex justify-between text-sm pt-2 border-t border-black/5">
                  <span className="font-bold">You pay</span>
                  <span className="font-black tabular-nums">
                    {formatUsdc(transferFee(Number(bill.myShare!.amount || 0)).grossUsdc)} USDC
                  </span>
                </div>
              </div>
                <div className="rounded-2xl border border-black/8 bg-[#FAFAFA] px-4 py-3 flex items-baseline justify-between">
                  <span className="text-sm font-medium text-black/45">Your balance</span>
                  <span className="text-lg font-black tabular-nums">{usdc?.formatted ?? "0"} USDC</span>
                </div>

                <button
                  onClick={payShare}
                  disabled={!canPayWithSaku || paying}
                  className="w-full py-4 bg-black text-white rounded-2xl font-bold shadow-lg disabled:opacity-25 active:scale-[0.98] transition-all flex items-center justify-center gap-2"
                >
                  {paying && <Loader2 className="w-4 h-4 animate-spin" />}
                  {paying ? "Paying…" : `Pay ${bill.myShare!.amount} USDC`}
                </button>
              </>
            ) : (
              <>
                <input
                  value={note}
                  maxLength={200}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Note — e.g. cash at the table, BCA transfer 14:20"
                  className="w-full px-4 py-3 bg-[#FAFAFA] border-2 border-transparent rounded-2xl text-sm font-semibold focus:border-black outline-none transition-all"
                />
                <button
                  onClick={() => settleExternally(note.trim())}
                  disabled={paying}
                  className="w-full py-4 bg-black text-white rounded-2xl font-bold shadow-lg disabled:opacity-40 active:scale-[0.98] transition-all flex items-center justify-center gap-2"
                >
                  {paying && <Loader2 className="w-4 h-4 animate-spin" />}
                  {paying ? "Recording…" : "Mark my share as paid"}
                </button>
                <p className="text-[11px] text-center text-black/35">
                  Nothing moves through Saku — this only records it, and the creator sees your note.
                </p>
              </>
            )}
          </div>
        ) : bill.myShare ? (
          <p className="text-sm text-center text-black/45">
            You&apos;ve paid your share
            {bill.myShare.status === "paid" && bill.shares.find((s) => s.isMe)?.paymentMethod === "external"
              ? " outside Saku."
              : "."}
          </p>
        ) : (
          <p className="text-sm text-center text-black/45">You created this bill.</p>
        )}
      </div>
    </div>
  )
}
